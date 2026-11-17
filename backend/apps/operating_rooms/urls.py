from django.urls import path

from . import views

urlpatterns = [
    path("", views.OperatingRoomListView.as_view(), name="operating-room-list"),
    path("<int:pk>/actions/", views.OperatingRoomActionView.as_view(), name="operating-room-action"),
]
