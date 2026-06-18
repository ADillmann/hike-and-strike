from app.database import Base, engine
from app.models import *  # noqa: F401, F403

Base.metadata.create_all(bind=engine)