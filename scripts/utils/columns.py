"""Safe value adaptation using explicitly supplied source-owned field definitions."""
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, localcontext
from .database import encode
from .model import DataError


def values(definition, projected):
    result=[]
    for field in definition['fields']:
        value=projected.get(field['name']);kind=field['sql_type'];fmt=field.get('output_format')
        if fmt=='placeholder_dash' and value is None: value='-'
        if fmt=='percent' and value is None: value='/'
        if value is not None:
            try:
                if fmt in ('percent','percent_2'):
                    if fmt=='percent_2':
                        with localcontext() as ctx:
                            ctx.prec=70
                            value=format(Decimal(value).quantize(Decimal('0.01')),'f')+'%'
                    else:
                        if value!='/':
                            number=Decimal(str(value).removesuffix('%'))
                            if not number.is_finite(): raise ValueError
                            value=format(number,'f')+'%'
                elif kind=='JSON':value=encode(value)
                elif kind=='BIGINT':
                    number=Decimal(value)
                    if number!=number.to_integral_value() or not -(2**63)<=number<2**63: raise ValueError
                    value=int(number)
                elif kind=='DATE':value=date.fromisoformat(str(value)[:10]).isoformat()
                elif kind=='DATETIME':value=datetime.fromisoformat(str(value)).strftime('%Y-%m-%d %H:%M:%S')
                elif kind.startswith(('VARCHAR','CHAR')):
                    value=str(value)
                    if len(value)>int(kind.split('(')[1].split(')')[0]): raise ValueError
            except (TypeError,ValueError,InvalidOperation) as error:
                raise DataError('字段不满足数据汇DDL类型：'+field['name']) from error
        if value is None and not field.get('sql_nullable',True):
            raise DataError('数据汇必需字段缺失：'+field['name'])
        result.append(value)
    return tuple(result)
