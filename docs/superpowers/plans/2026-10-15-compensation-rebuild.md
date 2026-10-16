# 三分类三类型薪酬规则实现计划

## 已确认口径
- 员工nonCompeteSigned默认false；缺省历史员工补false，旧工资快照不回写。
- 规则范围为global/rooms/employees。全局直接定义，直播间选房间，员工用可视AND/OR条件筛选。
- 所有命中规则按员工＋直播间＋月份数据行合并后执行一次；不将每条时薪规则独立计薪。
- 顺序allowance→premium→hourly；补贴按夜班场次×每场金额累加；保费系数命中取最大值，不命中为1。
- 有效保费=正常保费＋早班保费×有效系数，不回写源数据；时薪指标读取有效保费及其ROI。
- 时薪按hours/nightHours/earlyHours/regularHours分组；各组rate=max(所有触发保薪最大值,所有加成之和)，amount=rate×对应时长；组金额＋补贴构成月薪。
- 日期参考核算月末并冻结；withinMonths使用日历月，含基准与下限，不匹配未来日期；引用必需日期缺失阻断，不假造开播日期或入职日期。
- regularHours=hours−nightHours−earlyHours；earlyPremium按早班实际成交贡献；regularPremium=premium−earlyPremium（所有非早班）。
- 固定字段配置模板不让用户任意执行代码。未知字段/类型、无效范围、多命中、非有限/负值、重复粒度及版本漂移阻断。
- 保留旧departmentRules/payrollTasks/旧引擎给旧历史与任务；新compensationRules/compensationTasks独立，不改持久化key/version、不清空工资。混合新旧有效待核算任务时阻断并提示先撤回旧任务，不能混合两个核算模型。
- 新版规则初始草稿样例可演示补贴/系数/时薪，但未发布不计薪；六条原来源规则在来源/历史详情只读保留，不将不等价的来源优先保底偷偷改成max规则。

## Contract (src/compensation-rules.ts)
Types:
- Scope='global'|'rooms'|'employees'; CalculationType='allowance'|'premium'|'hourly'; NewDuration='hours'|'nightHours'|'earlyHours'|'regularHours'.
- Condition={kind:'condition';field:string;operator:'eq'|'ne'|'gt'|'gte'|'lt'|'lte'|'withinMonths';value:string|number|boolean}; ConditionGroup={kind:'group';operator:'and'|'or';children:(Condition|ConditionGroup)[]}.
- CompensationRule={id,name,version,status:'草稿'|'已发布',scope,roomIds:string[],employeeCondition?:ConditionGroup,type,allowance?:{field:'nightSessions';amount:number},premium?:{normalField:'regularPremium';earlyField:'earlyPremium';coefficient:number;condition:ConditionGroup},hourly?:{duration:NewDuration;items:HourlyItem[];formula:{mode:'additions';itemIds:string[]}|{mode:'guarantee';itemId:string}}}.
- HourlyItem={id,name,kind:'metric'|'special'|'guarantee',field?:string,bands?:RuleBand[],rate?:number,condition?:ConditionGroup}. RuleBand reuse existingpayroll-rules; newmetrictypes可拓展new core own band type if needed but必须通知UI。
- Export conditionFieldOptions, compensationMetricOptions, durationOptions (field/label/type metadata), blankConditionGroup(), validateCompensationRule(rule), referenceDateForMonth(month), matchesCompensationRule(rule,row,employees,rooms,month), calculateCompensation(rows,employees,deps,rooms,rules,month):CompensationResult.
- CompensationResult={salaries:Salary[],rows:PayrollRowCalculation[],referenceDate:string}. Rowtrace必须含employeeId/roomId/month/matchedRuleIds,allowance,premium前后及系数、duration分组rate/guarantee/additions/hours/amount,total和条件依据，具体字段core先导出通知UI/state。Salary.details兼容旧类型，仅summary；新rowtrace是新版计算明细权威依据。

## Task1 核心规则与合并计算
Own: new compensation-rules.ts/tests. 不改旧engine/domain/store/UI。
- [x] 类型与字段元数据先落地，通知其他worker。
- [x] TDD: AND/OR类型/日期边界/缺失数据、三范围、合并max/sum、按时长分组、系数后ROI、空范围/冲突/零时长/金额溢出。
- [x] 两阶段先对全体有效行合并系数并重算有效ROI及排名，再计算时薪；系数条件使用原始早班场次避免循环。
- [x] 提供明细与Salary兼容结果；不修改原monthly对象；新Salary trace由Batch可选compensationResult冻结。

## Task2 来源字段与直播间日期
Own: live-domain.ts/tests, room-reports.ts/tests, dataset-corrections.ts/tests, operations-domain.ts, LiveRoomConfig.tsx, LiveDatasetFields.ts, LiveDatasetSchema.tsx, DatasetCorrectionEditor.tsx, new focusedtests. 不改store/core/Rules。
- [x] LiveMonthly增加optional earlyPremium/regularPremium/regularHours，LiveDetail内部earlyPremium；实际小时成交→早班保费，常规派生值不手填。
- [x] 日报修改成交额按可验证的原成交贡献比例分配；改时间范围或零成交改为正值后，早班保费置为未知，不能按时长猜测，可人工核实月度早班保费。
- [x] 月度可改earlyPremium基础值但<=premium；regularPremium和regularHours自动重算，zero/missing历史显示未定义。
- [x] LiveRoom增加optional openedOn，配置/只读显示“开播日期”；不从最早采集日推测，日期格式由store最终校验。
- [x] 归档旧字段缺省不改冻结金额，旧tests保持兼容。

## Task3 状态任务持久化
Own: store.ts, newcompensation-store.test.ts/testsfixtures按需。保留parent员工defaults改动。
- [x] 新规则save/publish/withdraw状态，任务记录rule快照、month、employeeIds、rowKeys、datasetversion/revision、referenceDate和状态；初始newdraft独立，旧规则只读可查看。
- [x] 发布按scope/condition/currentactiverows确定名单；runPayroll统一合并所有新有效task规则调用calculateCompensation一次；名单/rowkeys漂移阻断，source stale阻断。
- [x] 新旧任务不混用；旧run保留原逻辑给已有tests/history。
- [x] Batch/PayrollSnapshot可选compensationResult/rules/tasks，persist默认新数组且key/version1不变。用可识别init marker避免老保存无新字段首次初始化又在后续清空状态时反复灌样例。
- [x] openedOn有效日期校验，不清空既有员工、数据或归档。

## Task4 规则及核算页面
Own: Rules.tsx, newCompensationRuleEditor/ConditionBuilder/HourlyBandEditor等UI、newcss；Payroll.tsx（含SalaryModal）。不改旧DepartmentRuleEditor，不改store/core。
- [x] 三个分类水平tab；范围/名称/类型/项目/公式编辑弹窗。员工条件可嵌套AND/OR；字段和值类型受控，保薪逻辑可引用employee/room，系数固定早班条件。
- [x] 时薪一个duration选择，项目metric/special/guarantee；metric复用精确/开放范围/关联档位；公式可选一个guarantee或多个addition。
- [x] 系数固定normal/early两个field选择及条件/coefficient；补贴nightSessions和per场金额。
- [x] 新规则save/view/publish，发布预览与错误；历史六规则只读来源查看。保持简洁无大段静态banner。
- [x] Payroll显示新scope/type任务，撤回、新旧兼容以及新mergedrowtrace；费用不可将coef增加一笔工资。

## Task5 控制器整合与验证
Parent: domain Employee/employee-fields/real-seed/People alreadychanged；App tour、canonical spec+README、plan进度及独立review/browserQA。
- [x] 已确认草案转正式规格；来源拆分、冲突例子、MySQL存储、日期快照、迁移边界。
- [x] 组合测试: globalallowance20+employeeallowance10，nightSessions2 =>60；coeff1.2与1.5取1.5，premium1000/early200=>1100；guarantee60 vsaddition80=>80×对应hours，加夜班项另计。
- [x] 全套tests/build、只读review、独立5175DEMO流程、截图；不写主工资、结束测试server。

## Review Focus
- 同一数据行合并一次，无同规则双重薪资；max取实际命中值，所有加成/补贴可追溯。
- 同员工多个直播间按各行分别比较，duration组独立，不跨room平均ROI；有效rank按room/month竞争排名。
- 保费系数不改raw或月度值，不加成一笔工资；normal+early=total，missing早班金额不猜。
- 月末日历月边界和无日期未知条件不能静默命中/漏算。
- 旧归档不被当前规则/员工协议/date/room修改改写；新旧任务混合阻断，所有失败原子。

## 完成验证（2026-10-15）
- `npm test`：26个文件、283项通过。
- `npm run build`：通过；保留现有大包体积提示。
- `git diff --check`：通过。
- 独立代码审查：初次发现历史时段修改猜分早班成交，已修正并增加回归；复审CLEAR/APPROVE，见 `.omo/evidence/compensation-rebuild-code-review.md`。
- 浏览器QA仅在独立5175执行：刷新月度数据；新增员工ID筛选及未签竞业协议保薪60；直播间ROI时薪80；全局早班系数1.2、夜班补贴20、夜班加成10；发布5任务、12名员工统一计算归档成功。
- 菅心茹冻结明细：正常保费45822＋早班14282×1.2＝有效保费62960.4，ROI由1.9314变为2.0231；总时长max(60,80)×16＝1280，夜班10×8＝80，补贴2×20＝40，合计1400。源月度总保费60104保持不变。归档后刷新、编辑禁用。
- 页面截图：`artifacts/2026-10-15-employee-guarantee-editor.png`、`artifacts/2026-10-15-compensation-rules.png`、`artifacts/2026-10-15-merged-compensation-detail.png`。
- 测试页面与5175服务已关闭；主DEMO在5174启动。未写入主浏览器的工资与归档，未提交、推送或部署。
