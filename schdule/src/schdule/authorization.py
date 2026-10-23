"""One renewal attempt per source, followed by target-specific checks."""
from collections import OrderedDict


def execute(targets,adapter,run,notifier,*,threshold=1800,wait=15):
    groups=OrderedDict()
    for target in targets:groups.setdefault(target.auth_key,[]).append(target)
    for group in groups.values():
        failures=[]
        for index,target in enumerate(group):
            result=adapter.check(target,renew=index==0,threshold=threshold,wait=wait)
            item={**target.summary(),**result,'operation':'maintain' if index==0 else 'check'}
            run.add(item)
            if result['code'] and result['code']!=6:failures.append(item)
            # A target scope failure must not hide other accounts on the same token.
        if failures:
            alert=notifier.send(group[0],'authorization_failed')
            run.add({**group[0].summary(),'operation':'notify',**alert})
    return run.finish()
