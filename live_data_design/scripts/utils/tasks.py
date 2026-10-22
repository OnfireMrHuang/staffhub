"""Source-neutral text, identity, and immutable task construction helpers."""
import hashlib
import json
import re
from .model import ConfigError, Route


def text(value, field, maximum=128):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise ConfigError(f'{field} 必须为1至{maximum}字符的文本')
    return value.strip()


def positive_id(value, field):
    value = text(value, field)
    if not re.fullmatch(r'[0-9]+', value) or int(value) <= 0:
        raise ConfigError(f'{field} 必须为正整数文本')
    return str(int(value))


def hash_value(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
        separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def build_task(source, product_id, room_id, credential, account_id, options, scope):
    """The caller owns scope semantics; credentials and labels never change identity."""
    product_id = text(product_id, 'product_id')
    room_id = text(room_id, 'room_id')
    credential = text(credential, 'credential')
    identity = [source, product_id, room_id, account_id, scope]
    return Route('task-' + hash_value(identity), product_id, room_id, source,
                 credential, account_id, dict(options))
