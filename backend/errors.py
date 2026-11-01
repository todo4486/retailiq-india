"""Application errors that the API layer turns into clean JSON responses."""


class ApiError(Exception):
    def __init__(self, message, status=400, code="bad_request"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


class WarehouseEmpty(ApiError):
    def __init__(self):
        super().__init__(
            "The warehouse is empty. Run the ETL pipeline to load a dataset.",
            status=409,
            code="warehouse_empty",
        )
