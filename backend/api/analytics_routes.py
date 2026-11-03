"""Routes for the Overview, OLAP Studio, Customer Intelligence, Market Basket and Reports."""
from flask import Blueprint, Response, jsonify, request

from db.connection import scalar
from errors import ApiError
from etl import pipeline
from mining import apriori, rfm
from services import overview as overview_service
from services import pdf, reports
from services.datasets import notice_for
from warehouse import olap

bp = Blueprint("analytics", __name__, url_prefix="/api")


@bp.get("/status")
def status():
    """Drives the status indicator in the navigation bar."""
    last = pipeline.latest_success()
    current = pipeline.latest_run()
    fact_rows = scalar("SELECT COUNT(*) FROM FACT_SALES")
    return jsonify({
        "database": "connected",
        "dataset": last["dataset_name"] if last else None,
        "dataset_id": last["dataset_id"] if last else None,
        "currency": "₹",
        "data_kind": last["kind"] if last else None,
        **({"data_notice": notice_for(last["dataset_id"], last["kind"])} if last else {"data_notice": None}),
        "fact_rows": fact_rows,
        "last_sync": last["finished_at"] if last else None,
        "etl_running": bool(current and current["status"] == "running"),
        "running_run_id": current["run_id"] if current and current["status"] == "running" else None,
        "last_status": current["status"] if current else None,
    })


@bp.get("/public/summary")
def public_summary():
    """Totals for the public landing page. Only ever exposes the synthetic demo data."""
    return jsonify(overview_service.public_summary())


@bp.get("/overview")
def overview():
    args = request.args
    return jsonify(overview_service.overview(args.get("from"), args.get("to"), args.get("compare", "previous")))


@bp.get("/span")
def span():
    return jsonify(overview_service.span())


@bp.get("/olap/members")
def olap_members():
    return jsonify(olap.members())


@bp.post("/olap/execute")
def olap_execute():
    body = request.get_json(force=True) or {}
    return jsonify(olap.execute_operation(body.get("operation", "view"), body.get("state"), body.get("args")))


@bp.get("/customers/overview")
def customers_overview():
    return jsonify(rfm.get_overview())


@bp.get("/customers/points")
def customers_points():
    return jsonify(rfm.get_points())


@bp.get("/customers/list")
def customers_list():
    args = request.args
    return jsonify(rfm.get_customers(
        segment=args.get("segment"), search=args.get("search", ""), sort=args.get("sort", "monetary"),
        direction=args.get("dir", "desc"), page=args.get("page", 1, type=int), page_size=args.get("size", 25, type=int),
    ))


@bp.post("/customers/cluster")
def customers_cluster():
    body = request.get_json(force=True) or {}
    try:
        k = int(body.get("k", 5))
    except (TypeError, ValueError):
        raise ApiError("k must be a whole number.")
    return jsonify(rfm.run_clustering(k))


@bp.get("/basket/rules")
def basket_rules():
    args = request.args
    return jsonify(apriori.get_rules(
        sort=args.get("sort", "lift"), direction=args.get("dir", "desc"), search=args.get("search", ""),
        product_id=args.get("product", type=int), page=args.get("page", 1, type=int), page_size=args.get("size", 25, type=int),
    ))


@bp.get("/basket/products")
def basket_products():
    return jsonify(apriori.rule_products())


@bp.get("/basket/products/<int:product_id>")
def basket_product(product_id):
    return jsonify(apriori.associations_for(product_id))


@bp.get("/basket/network")
def basket_network():
    return jsonify(apriori.network(request.args.get("limit", 40, type=int)))


@bp.post("/basket/run")
def basket_run():
    body = request.get_json(force=True) or {}
    try:
        return jsonify(apriori.run_apriori(
            body.get("min_support"), body.get("min_confidence"), body.get("min_lift"),
            body.get("max_len"), body.get("city"), body.get("level"),
        ))
    except (TypeError, ValueError) as exc:
        raise ApiError(f"Invalid Apriori parameters: {exc}")


@bp.get("/reports/<report_type>")
def report(report_type):
    args = request.args
    built = reports.build_report(report_type, args.get("from"), args.get("to"))
    export = args.get("format", "json")
    stamp = built["generated_at"][:10]
    if export == "csv":
        return Response(
            "﻿" + reports.to_csv(built), mimetype="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="retailiq-{report_type}-{stamp}.csv"'},
        )
    if export == "pdf":
        return Response(
            pdf.build_pdf(built), mimetype="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="retailiq-{report_type}-{stamp}.pdf"'},
        )
    return jsonify(built)
