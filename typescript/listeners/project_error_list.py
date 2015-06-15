from ..libs.view_helpers import *
from ..libs.text_helpers import *
from ..libs import log
from .event_hub import EventHub

from ..commands import TypescriptProjectErrorList


class ProjectErrorListener:

    def __init__(self):
        self.just_changed_focus = False
        self.modified = False
        self.error_info_requested_not_received = False

    def on_activated_with_info(self, view, info):
        # Ask server for initial error diagnostics
        if is_project_error_list_started():
            self.request_errors(view, info, 200)
            self.set_on_idle_timer(IDLE_TIME_LENGTH)
            self.just_changed_focus = True

    def post_on_modified(self, view):
        if not is_special_view(view) and is_project_error_list_started()::
            self.modified = True
            self.set_on_idle_timer(100)

    def set_on_idle_timer(self, ms):
        """Set timer to go off when file not being modified"""
        self.pending_timeout += 1
        sublime.set_timeout(self.handle_time_out, ms)

    def handle_time_out(self):
        self.pending_timeout -= 1
        # Only process one idle request during the timeout period
        if self.pending_timeout == 0:
            self.on_idle()

    def on_idle(self):
        if cli.project_error_list_enabled:
            self.update_project_error_list()

        view = active_view()
        info = get_info(view)
        if info:
            log.debug("asking for project errors")
            # request errors
            self.request_errors(view, info, 500)

    def request_errors(self, view, info, error_delay):
        if info and cli.project_error_list_enabled and (
            self.just_changed_focus or
            info.change_count_when_last_err_req_sent < change_count(view)
        ):
            self.just_changed_focus = False
            cli.service.request_get_err_for_project(error_delay, view.file_name())
            self.set_on_idle_timer(error_delay + 300)

    def update_project_error_list(self):
        # Retrieve the project wide errors
        error_list_panel = TypescriptProjectErrorList.error_list_panel
        test_ev = cli.service.get_event_from_worker()
        if test_ev:
            self.error_info_requested_not_received = False
            if is_view_visible(error_list_panel):
                while test_ev:
                    error_list_panel.run_command("append", {"characters": str(test_ev) + "\n"})
                    test_ev = cli.service.get_event_from_worker()
            self.set_on_idle_timer(50)
        elif self.error_info_requested_not_received:
            self.set_on_idle_timer(50)

listener = ProjectErrorListener()
EventHub.subscribe("on_activated_with_info", listener.on_activated_with_info)
EventHub.subscribe("post_on_modified", listener.post_on_modified)