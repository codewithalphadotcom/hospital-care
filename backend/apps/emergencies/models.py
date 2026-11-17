from django.conf import settings
from django.db import models
from django.db.models import Case, Value, When


class ErStatus(models.TextChoices):
    ACCEPTING = "accepting", "Accepting patients"
    BUSY = "busy", "Very busy"
    DIVERTING = "diverting", "Not accepting ambulances"


class EmergencyStatus(models.Model):
    """The emergency department's current public status. A single row (pk=1), edited by staff."""

    status = models.CharField(max_length=20, choices=ErStatus.choices, default=ErStatus.ACCEPTING)
    wait_minutes = models.PositiveIntegerField(default=0)
    waiting_count = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "emergency status"

    def __str__(self):
        return self.get_status_display()

    @classmethod
    def current(cls) -> "EmergencyStatus":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


# ── Emergency cases (stories #30, #32) ────────────────────────────────────────────────────────────


class Severity(models.TextChoices):
    """Most severe first. The order here is the order lists sort by (see `by_priority`)."""

    CRITICAL = "critical", "Critical"
    HIGH = "high", "High"
    MODERATE = "moderate", "Moderate"
    LOW = "low", "Low"


class RequestStatus(models.TextChoices):
    """The full lifecycle from the ERD. A new case is `open`; the moves between statuses arrive with #34."""

    OPEN = "open", "Open"
    MATCHING = "matching", "Matching"
    PARTIALLY_FULFILLED = "partiallyFulfilled", "Partially fulfilled"
    FULFILLED = "fulfilled", "Fulfilled"
    ESCALATED = "escalated", "Escalated"
    CLOSED = "closed", "Closed"
    CANCELLED = "cancelled", "Cancelled"


class EmergencyRequestQuerySet(models.QuerySet):
    def by_priority(self):
        """Most severe first, then the case waiting longest (oldest), then id so the order is stable."""
        rank = Case(
            *[When(severity=level, then=Value(i)) for i, level in enumerate(Severity.values)],
            default=Value(len(Severity.values)),
            output_field=models.PositiveSmallIntegerField(),
        )
        return self.annotate(priority=rank).order_by("priority", "created_at", "id")


class EmergencyRequest(models.Model):
    """An emergency case and what it needs (story #30). Holds no patient-identifying data."""

    reference = models.CharField(max_length=16, unique=True, help_text='e.g. "EC-2026-0001". The API id.')
    hospital = models.ForeignKey(
        "hospitals.Hospital", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    severity = models.CharField(max_length=10, choices=Severity.choices)
    status = models.CharField(max_length=20, choices=RequestStatus.choices, default=RequestStatus.OPEN)
    patient_ref = models.CharField(
        max_length=30, blank=True, help_text="Optional bed or triage tag. Never a name."
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects = EmergencyRequestQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return self.reference


class ResourceType(models.TextChoices):
    """What a case can ask for. Equipment and operating rooms join when they exist (#26, #28)."""

    BLOOD = "blood", "Blood"
    BED = "bed", "Bed"


class RequestItem(models.Model):
    """One thing a case needs (story #32): blood of a group and component, or beds of a type."""

    request = models.ForeignKey(EmergencyRequest, on_delete=models.CASCADE, related_name="items")
    resource_type = models.CharField(max_length=10, choices=ResourceType.choices)
    blood_group = models.CharField(max_length=3, blank=True)
    component = models.CharField(max_length=10, blank=True)
    bed_type = models.CharField(max_length=12, blank=True)
    quantity = models.PositiveSmallIntegerField()
    fulfilled = models.PositiveSmallIntegerField(default=0, help_text="Filled in by allocation (#45).")

    class Meta:
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(quantity__gt=0), name="emergencies_item_quantity_positive"
            ),
            models.CheckConstraint(
                condition=models.Q(fulfilled__lte=models.F("quantity")),
                name="emergencies_item_fulfilled_within_quantity",
            ),
        ]

    def __str__(self):
        what = (
            f"{self.blood_group} {self.component}"
            if self.resource_type == ResourceType.BLOOD
            else self.bed_type
        )
        return f"{self.request_id}: {self.quantity} × {what}"
