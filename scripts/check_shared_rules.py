"""
Keeps the rules the frontend and backend both hard-code identical.

Three tables exist twice, once in Python and once in TypeScript, because the UI needs them without a round
trip:

- who can see/edit each module     backend/apps/accounts/permissions.py   frontend/src/features/staff/roles.ts
- shelf life per blood component   backend/apps/blood/serializers.py      frontend/src/api/blood.ts
- min stock per component/group    backend/apps/blood/models.py           frontend/src/api/blood.ts

If they drift, the UI shows a button the API then refuses, or a stock level the API disagrees with. This
reads both sides as text (no Django or Node needed) and fails CI on any difference.
"""

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend" / "apps"
FRONTEND = ROOT / "frontend" / "src"


# ── Python side ──────────────────────────────────────────────────────────────────────────────────


def _module(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"))


def _assigned(tree: ast.Module, name: str) -> ast.expr:
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == name for t in node.targets):
            return node.value
        if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", None) == name:
            return node.value
    raise LookupError(f"{name} not found")


def _choices(tree: ast.Module, class_name: str) -> dict[str, str]:
    """TextChoices members → their stored values, e.g. {"BLOOD_BANK": "bloodBank"}."""
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            values = {}
            for item in node.body:
                if isinstance(item, ast.Assign) and isinstance(item.value, ast.Tuple):
                    values[item.targets[0].id] = ast.literal_eval(item.value.elts[0])
            return values
    raise LookupError(f"class {class_name} not found")


def _key(node: ast.expr, enum: dict[str, str]) -> str:
    """`Role.ADMIN` → "admin"; a plain string stays as it is."""
    if isinstance(node, ast.Attribute):
        return enum[node.attr]
    return ast.literal_eval(node)


def python_access() -> dict[str, dict[str, str]]:
    roles = _choices(_module(BACKEND / "accounts" / "models.py"), "Role")
    table = _assigned(_module(BACKEND / "accounts" / "permissions.py"), "ACCESS")
    names = {"VIEW": "view", "EDIT": "edit"}
    access = {}
    for role_node, modules in zip(table.keys, table.values, strict=True):
        access[_key(role_node, roles)] = {
            ast.literal_eval(k): names[v.id] for k, v in zip(modules.keys, modules.values, strict=True)
        }
    return {role: modules for role, modules in access.items() if modules}  # patients have none


def python_shelf_life() -> dict[str, int]:
    components = _choices(_module(BACKEND / "blood" / "models.py"), "Component")
    table = _assigned(_module(BACKEND / "blood" / "serializers.py"), "SHELF_LIFE_DAYS")
    return {_key(k, components): ast.literal_eval(v) for k, v in zip(table.keys, table.values, strict=True)}


def python_minimum_stock() -> dict[str, dict[str, int]]:
    tree = _module(BACKEND / "blood" / "models.py")
    components = _choices(tree, "Component")
    table = _assigned(tree, "MINIMUM_STOCK")
    return {_key(k, components): ast.literal_eval(v) for k, v in zip(table.keys, table.values, strict=True)}


# ── TypeScript side ──────────────────────────────────────────────────────────────────────────────


def _value_of(source: str, name: str) -> str:
    """Inside of the `{ ... }` or `[ ... ]` literal assigned to `const <name>` (after its type), balanced."""
    match = re.search(rf"\bconst {name}\b[^=]*=\s*([\[{{])", source)
    if match is None:
        raise LookupError(f"const {name} not found")
    start = match.start(1)
    depth = 0
    for i in range(start, len(source)):
        if source[i] in "{[":
            depth += 1
        elif source[i] in "}]":
            depth -= 1
            if depth == 0:
                return source[start + 1 : i]
    raise ValueError(f"unbalanced literal in const {name}")


def _inner_tables(block: str) -> dict[str, str]:
    """`key: { ... }` pairs at the top level of an object literal."""
    return {m.group(1): m.group(2) for m in re.finditer(r"['\"]?(\w+)['\"]?\s*:\s*\{([^}]*)\}", block)}


def typescript_access() -> dict[str, dict[str, str]]:
    source = (FRONTEND / "features" / "staff" / "roles.ts").read_text(encoding="utf-8")
    block = _value_of(source, "ACCESS")
    return {
        role: dict(re.findall(r"(\w+)\s*:\s*'(view|edit)'", modules))
        for role, modules in _inner_tables(block).items()
    }


def typescript_shelf_life() -> dict[str, int]:
    source = (FRONTEND / "api" / "blood.ts").read_text(encoding="utf-8")
    block = _value_of(source, "COMPONENTS")
    return {c: int(days) for c, days in re.findall(r"id:\s*'(\w+)'[^}]*?shelfLifeDays:\s*(\d+)", block)}


def typescript_minimum_stock() -> dict[str, dict[str, int]]:
    source = (FRONTEND / "api" / "blood.ts").read_text(encoding="utf-8")
    block = _value_of(source, "MINIMUM_STOCK")
    return {
        component: {group: int(n) for group, n in re.findall(r"'([ABO]{1,2}[+-])'\s*:\s*(\d+)", groups)}
        for component, groups in _inner_tables(block).items()
    }


# ── Compare ──────────────────────────────────────────────────────────────────────────────────────

CHECKS = [
    ("module access (ACCESS)", python_access, typescript_access),
    ("component shelf life (SHELF_LIFE_DAYS / shelfLifeDays)", python_shelf_life, typescript_shelf_life),
    ("minimum blood stock (MINIMUM_STOCK)", python_minimum_stock, typescript_minimum_stock),
]


def main() -> int:
    failed = False
    for label, backend, frontend in CHECKS:
        py, ts = backend(), frontend()
        if not py or not ts:
            print(f"FAIL {label}: couldn't read one side (backend {len(py)} entries, frontend {len(ts)}).")
            failed = True
        elif py != ts:
            print(f"FAIL {label} differs between backend and frontend:")
            for key in sorted(py.keys() | ts.keys()):
                if py.get(key) != ts.get(key):
                    print(f"    {key}: backend {py.get(key)!r}, frontend {ts.get(key)!r}")
            failed = True
        else:
            print(f"ok   {label}: {len(py)} entries match.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
