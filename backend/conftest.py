import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.hospitals.models import Hospital

PASSWORD = "Strong-pass-123"


@pytest.fixture(autouse=True)
def fast_password_hashing(settings):
    """Django's default hasher is deliberately slow (over a million PBKDF2 rounds) and almost every test
    creates a user, so it dominated the suite's run time. Tests don't need real hashing strength."""
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]


@pytest.fixture(autouse=True)
def fresh_cache():
    """Failed-login counts live in the cache; every test starts with none."""
    cache.clear()


@pytest.fixture
def api():
    return APIClient(enforce_csrf_checks=True)


@pytest.fixture
def make_user(db):
    def make(role=Role.PATIENT, email=None, **extra):
        email = email or f"{role.lower()}@example.com"
        return User.objects.create_user(username=email, email=email, password=PASSWORD, role=role, **extra)

    return make


@pytest.fixture
def client_as(make_user):
    """An API client already signed in with the given role (optionally at a hospital)."""

    def signed_in(role, **extra):
        client = APIClient()
        client.force_authenticate(make_user(role, **extra))
        return client

    return signed_in


@pytest.fixture
def make_hospital(db):
    def make(name="CityCare General Hospital", **extra):
        fields = {"address": "Shahrah-e-Faisal, Karachi", "latitude": "24.860700", "longitude": "67.001100"}
        return Hospital.objects.create(name=name, **{**fields, **extra})

    return make
