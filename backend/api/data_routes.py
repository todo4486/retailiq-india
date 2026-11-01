"""Routes for datasets (Data Explorer), the ETL pipeline and the warehouse catalog."""
import json

from flask import Blueprint, jsonify, request

from errors import ApiError
from etl import pipeline
from services import datasets
from warehouse import catalog

bp = Blueprint("data", __name__, url_prefix="/api")


@bp.get("/datasets")
def list_datasets():
    return jsonify(datasets.list_datasets())


@bp.post("/datasets")
def upload_dataset():
    file = request.files.get("file")
    if not file or not file.filename:
        raise ApiError("Choose a CSV file to upload.")
    return jsonify(datasets.save_upload(file)), 201


@bp.delete("/datasets/<dataset_id>")
def delete_dataset(dataset_id):
    datasets.delete_dataset(dataset_id)
    return jsonify({"deleted": dataset_id})


@bp.patch("/datasets/<dataset_id>")
def update_dataset(dataset_id):
    body = request.get_json(force=True) or {}
    return jsonify(datasets.update_settings(dataset_id, body.get("roles"), body.get("inr_rate")))


@bp.get("/datasets/<dataset_id>/profile")
def dataset_profile(dataset_id):
    return jsonify(datasets.get_profile(dataset_id))


@bp.get("/datasets/<dataset_id>/rows")
def dataset_rows(dataset_id):
    args = request.args
    try:
        filters = json.loads(args.get("filters", "[]"))
    except ValueError:
        raise ApiError("Invalid filters.")
    return jsonify(datasets.get_rows(
        dataset_id, search=args.get("search", ""), sort=args.get("sort"), direction=args.get("dir", "asc"),
        page=args.get("page", 1, type=int), page_size=args.get("size", 50, type=int), filters=filters,
        view=args.get("view", "all"),
    ))


@bp.post("/etl/runs")
def start_etl():
    body = request.get_json(force=True) or {}
    meta = datasets.get_meta(body.get("dataset_id", ""))
    run_id = pipeline.start_run(meta["id"], meta["name"], meta["path"], meta.get("roles", {}), meta.get("kind", "imported"),
                                meta.get("inr_rate", 1.0))
    return jsonify({"run_id": run_id}), 202


@bp.get("/etl/runs")
def etl_history():
    return jsonify(pipeline.history())


@bp.get("/etl/runs/<int:run_id>")
def etl_run(run_id):
    run = pipeline.get_run(run_id)
    if not run:
        raise ApiError("Run not found.", status=404, code="not_found")
    return jsonify(run)


@bp.get("/warehouse/schema")
def warehouse_schema():
    return jsonify(catalog.schema())


@bp.get("/warehouse/tables/<table>")
def warehouse_table(table):
    args = request.args
    return jsonify(catalog.table_detail(
        table, page=args.get("page", 1, type=int), page_size=args.get("size", 10, type=int),
        sort=args.get("sort"), direction=args.get("dir", "asc"),
    ))
