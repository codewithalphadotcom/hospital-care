from django.db import models
from django.db.models.functions import Lower

from apps.resources.models import Resource
from apps.resources.state_machine import StateMachine


class AmbulanceType(models.TextChoices):
    """Life support level of the vehicle (story #50)."""

    BASIC = "basic", "Basic life support"
    ADVANCED = "advanced", "Advanced life support"
    PATIENT_TRANSPORT = "patientTransport", "Patient transport"


class AmbulanceStatus(models.TextChoices):
    AVAILABLE = "available", "Available"
    MAINTENANCE = "maintenance", "In maintenance"
    OUT_OF_SERVICE = "outOfService", "Out of service"


S = AmbulanceStatus

# Status changes go through POST /api/ambulances/<id>/actions/. Dispatch and "on trip" come with B05.
AMBULANCE_LIFECYCLE = StateMachine(
    "vehicle",  # for the 409 message: "Can't outOfService a vehicle that is out of service."
    AmbulanceStatus,
    {
        (S.AVAILABLE, "startMaintenance"): S.MAINTENANCE,
        (S.MAINTENANCE, "finishMaintenance"): S.AVAILABLE,
        (S.AVAILABLE, "outOfService"): S.OUT_OF_SERVICE,
        (S.MAINTENANCE, "outOfService"): S.OUT_OF_SERVICE,
        (S.OUT_OF_SERVICE, "returnToService"): S.MAINTENANCE,
    },
)


class Ambulance(Resource):
    """One ambulance at its base hospital, e.g. AMB-04, advanced life support (story #50)."""

    machine = AMBULANCE_LIFECYCLE

    identifier = models.CharField(
        max_length=40, help_text="Asset tag, e.g. AMB-04. Unique within a hospital."
    )
    type = models.CharField(max_length=20, choices=AmbulanceType.choices)
    status = models.CharField(
        max_length=20, choices=AmbulanceStatus.choices, default=AmbulanceStatus.AVAILABLE
    )

    class Meta:
        ordering = ["type", "identifier"]
        indexes = [models.Index(fields=["type", "status"])]
        constraints = [
            models.UniqueConstraint(
                "hospital",
                Lower("identifier"),
                nulls_distinct=False,  # unique for network-level (no hospital) rows too
                name="ambulance_identifier_unique_per_hospital",
            )
        ]

    def __str__(self):
        return f"{self.identifier} ({self.get_type_display()})"
