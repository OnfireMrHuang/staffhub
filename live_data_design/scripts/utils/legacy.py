"""Use the repository's tested Ocean Engine query/filter contracts unchanged."""
from functools import lru_cache
from pathlib import Path
import sys
from .model import ConfigError

@lru_cache(maxsize=1)
def reports():
    directory=Path(__file__).resolve().parents[3]/'tools'/'data_report_tool'
    if not (directory/'report_tool.py').exists():
        raise ConfigError('需要同一仓库中的 tools/data_report_tool')
    sys.path.insert(0,str(directory))
    try:
        import report_tool
        return report_tool
    finally:
        sys.path.remove(str(directory))
