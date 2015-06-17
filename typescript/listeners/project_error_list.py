from ..libs.view_helpers import *
from ..libs.text_helpers import *
from ..libs import get_panel_manager, log
from .event_hub import EventHub


class ProjectErrorListener:

    def __init__(self):
        self.just_changed_focus = False
        self.modified = False
        self.error_info_requested_not_received = False
        self.pending_timeout = 0
        self.errors = dict()

    def is_error_list_panel_active(self):
        return get_panel_manager().is_panel_active("errorlist")

    def on_activated_with_info(self, view, info):
        # Only starts the timer when the error list panel is active
        if self.is_error_list_panel_active():
            self.request_errors(view, info, 200)
            self.set_on_idle_timer(IDLE_TIME_LENGTH)
            self.just_changed_focus = True

    def post_on_modified(self, view):
        if not is_special_view(view) and self.is_error_list_panel_active():
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
        self.update_error_list_panel()

        view = active_view()
        info = get_info(view)
        if info:
            log.debug("asking for project errors")
            if self.is_error_list_panel_active():
                self.request_errors(view, info, 100)
            else:
                cli.node_client.stopWorker()

    def update_error_list_panel(self):
        test_ev = cli.service.get_event_from_worker()
        if test_ev:
            self.error_info_requested_not_received = False
            self.load_error(test_ev)

            # There may be multiple events coming simultaniously
            while test_ev:
                self.load_error(test_ev)                   
                test_ev = cli.service.get_event_from_worker()

            output_lines = []
            for file in self.errors:
                if len(self.errors[file]["syntaxDiag"]) + len(self.errors[file]["semanticDiag"]) > 0:
                    output_lines.append(file)
                    output_lines.extend(self.errors[file]["syntaxDiag"] + self.errors[file]["semanticDiag"])
            get_panel_manager().write_lines_to_panel("errorlist", output_lines)
            self.set_on_idle_timer(50)
        elif self.error_info_requested_not_received:
            self.set_on_idle_timer(50)

    def load_error(self, json_dict):
        if json_dict["type"] != "event":
            return

        error_type = json_dict["event"]
        if error_type not in ["syntaxDiag", "semanticDiag"]:
            return

        body = json_dict["body"]
        if body is not None:
            file = body["file"]
            if file not in self.errors:
                self.errors[file] = { "syntaxDiag": [], "semanticDiag": [] }
            self.errors[file][error_type] = []
            diags = body["diagnostics"]
            for diag in diags:
                message = "    ({0}, {1}) {2}".format(
                    diag["start"]["line"],
                    diag["start"]["offset"],
                    diag["text"]
                    )
                self.errors[file][error_type].append(message)

    def request_errors(self, view, info, error_delay):
        if info and self.is_error_list_panel_active() and (
            self.just_changed_focus or
            self.modified
        ):
            self.just_changed_focus = False
            self.modified = False
            cli.service.request_get_err_for_project(error_delay, view.file_name())
            self.error_info_requested_not_received = True
            self.set_on_idle_timer(error_delay + 300)

listener = ProjectErrorListener()

def start_timer():
    global listener
    listener.just_changed_focus = True
    listener.set_on_idle_timer(50)

EventHub.subscribe("on_activated_with_info", listener.on_activated_with_info)
EventHub.subscribe("post_on_modified", listener.post_on_modified)