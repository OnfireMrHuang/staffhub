"""Locally packaged Ocean Engine protocol primitives; no repository path mutation."""
from functools import lru_cache

@lru_cache(maxsize=1)
def reports():
    from .oceanengine import report_tool
    return report_tool
