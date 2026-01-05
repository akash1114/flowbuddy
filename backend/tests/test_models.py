from app.db.base import Base
from app.db import models  # noqa: F401  ensure models are loaded


def test_metadata_contains_core_tables() -> None:
    table_names = set(Base.metadata.tables.keys())
    expected = {
        "users",
        "resolutions",
        "tasks",
        "brain_dumps",
        "agent_actions_log",
    }

    assert expected.issubset(table_names)
