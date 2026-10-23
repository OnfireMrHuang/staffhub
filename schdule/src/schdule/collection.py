"""Room ordering and failure policy, using source-owned date/granularity rules."""
from scripts.utils.model import DayWindow


def windows(target,window):
    if target.binding.source=='qianchuan':
        return [target.api.collection_window(target.task,window)]
    return [DayWindow.parse(day) for day in window.dates()] if target.binding.source=='zhongan' else [window]


def execute(targets,adapter,run,notifier,window,*,on_error='continue',notify=False):
    skipped=set()
    stopped=False
    for target in targets:
        for period in windows(target,window):
            item={**target.summary(),'start':period.start.isoformat(),'end':period.end.isoformat()}
            if stopped or target.binding.room_key in skipped:
                run.add({**item,'code':0,'status':'skipped','reason':'abort' if stopped else 'skip-room'})
                continue
            result=adapter.collect(target,period)
            run.add({**item,**result})
            code=result['code']
            if not code:continue
            if notify and code!=6:
                run.add({**target.summary(),'operation':'notify',**notifier.send(target,'collection_failed')})
            if code==5 or on_error=='abort':stopped=True
            if on_error=='skip-room':skipped.add(target.binding.room_key)
    return run.finish()
