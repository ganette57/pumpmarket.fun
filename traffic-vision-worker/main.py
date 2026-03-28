import uvicorn

from api import app
from config import SETTINGS


if __name__ == "__main__":
    uvicorn.run(app, host=SETTINGS.host, port=SETTINGS.port)
