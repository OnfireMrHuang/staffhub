"""Cross-task safety checks over scopes owned by the collector modules."""
from scripts.utils.model import ConfigError, Scope, SOURCES


def validate_routes(routes, credentials):
    from scripts import registry
    ids = set()
    scopes = {}
    for route in routes:
        if not isinstance(route.enabled, bool) or not isinstance(route.options, dict):
            raise ConfigError('路由 enabled 必须为布尔值，options 必须为对象')
        for key in ('route_id', 'product_id', 'room_id', 'source', 'credential'):
            value = getattr(route, key)
            if not isinstance(value, str) or not value.strip() or len(value) > 128:
                raise ConfigError(f'路由 {key} 必须为1至128字符的文本')
        if route.route_id in ids:
            raise ConfigError('route_id 重复')
        ids.add(route.route_id)
        if (route.source not in SOURCES or route.credential not in credentials
                or credentials[route.credential].get('source') != route.source):
            raise ConfigError('来源或凭据别名不匹配')
        if not route.enabled:
            continue
        scope = registry.get(route.source).task.validate(route)
        if not isinstance(scope, Scope) or not isinstance(scope.resource, tuple):
            raise ConfigError('采集器必须返回有效的查询范围描述')
        previous = scopes.setdefault(scope.resource, [])
        for other in previous:
            if scope.namespace and other.namespace and scope.namespace != other.namespace:
                raise ConfigError('同一资源不能混用查询标识命名空间，无法离线证明范围互斥')
            if scope.selector == other.selector or '*' in (scope.selector, other.selector):
                raise ConfigError('重复或重叠的来源查询范围，不能重复归因')
        previous.append(scope)
