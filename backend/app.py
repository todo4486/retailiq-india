"""RetailIQ API server. Run with: python app.py"""
import datetime as dt
import logging
import traceback

from flask import Flask, jsonify
from sqlalchemy.exc import OperationalError
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

import config
from api.analytics_routes import bp as analytics_bp
from api.auth_routes import bp as auth_bp
from api.auth_routes import require_login
from api.data_routes import bp as data_bp
from db.schema import create_all, migrate_if_needed
from errors import ApiError
from etl.pipeline import mark_interrupted_runs
from services.datasets import ensure_builtin


def create_app():
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = config.MAX_UPLOAD_BYTES
    app.json.sort_keys = False
    # Session cookie: signed, hidden from JavaScript, and not sent on cross-site requests.
    app.secret_key = config.secret_key()
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax", SESSION_COOKIE_NAME="retailiq_session",
                      PERMANENT_SESSION_LIFETIME=dt.timedelta(days=30))
    app.before_request(require_login)
    app.register_blueprint(auth_bp)
    app.register_blueprint(data_bp)
    app.register_blueprint(analytics_bp)

    @app.errorhandler(ApiError)
    def handle_api_error(error):
        return jsonify({"error": {"code": error.code, "message": error.message}}), error.status

    @app.errorhandler(OperationalError)
    def handle_db_down(_error):
        return jsonify({"error": {
            "code": "database_unavailable",
            "message": f"MySQL is not reachable on {config.DB_HOST}:{config.DB_PORT}. Start it with scripts/mysql.sh start.",
        }}), 503

    @app.errorhandler(RequestEntityTooLarge)
    def handle_too_large(_error):
        limit = config.MAX_UPLOAD_BYTES // (1024 * 1024)
        return jsonify({"error": {"code": "too_large", "message": f"The file exceeds the {limit} MB upload limit."}}), 413

    @app.errorhandler(HTTPException)
    def handle_http(error):
        return jsonify({"error": {"code": "http_error", "message": error.description}}), error.code

    @app.errorhandler(Exception)
    def handle_unexpected(_error):
        traceback.print_exc()
        return jsonify({"error": {"code": "server_error", "message": "The server hit an unexpected error."}}), 500

    # Prepare the database. If MySQL is down the API still starts and answers with a clear 503.
    try:
        migrate_if_needed()
        create_all()
        mark_interrupted_runs()
    except OperationalError as exc:
        logging.warning("MySQL unavailable at start-up: %s", exc)
    ensure_builtin()
    return app


if __name__ == "__main__":
    # threaded=True keeps the API responsive while ETL or mining is working.
    create_app().run(host="127.0.0.1", port=config.API_PORT, threaded=True, debug=False)
