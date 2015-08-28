from ..libs.view_helpers import *
from ..libs.text_helpers import *
from ..libs import get_panel_manager, log
from .event_hub import EventHub


class ProjectErrorListener:

    def __init__(self):
        self.just_changed_focus = False
        self.modified = False
        self.pending_timeout = 0
        self.pending_update_error_list_panel = 0
        self.errors = dict()
        self.event_handler_added = False

    def is_error_list_panel_active(self):
        return get_panel_manager().is_panel_active("errorlist")

    def on_activated_with_info(self, view, info):
        # Only starts the timer when the error list panel is active
        if self.is_error_list_panel_active():
            self.set_request_error_timer(50)
            self.just_changed_focus = True

    def post_on_modified(self, view):
        if not is_special_view(view) and self.is_error_list_panel_active():
            self.modified = True
            self.set_request_error_timer(150)
            log.debug("error list timer started")

    def set_request_error_timer(self, ms):
        """Set timer to go off when file not being modified"""
        self.pending_timeout += 1
        sublime.set_timeout(self.handle_time_out, ms)

    def handle_time_out(self):
        self.pending_timeout -= 1
        if self.pending_timeout == 0:
            self.on_idle()

    def on_idle(self):
        view = active_view()
        info = get_info(view)
        if info:
            log.debug("asking for project errors")
            if self.is_error_list_panel_active():
                self.request_errors(view, info, 100)

    def load_error(self, json_dict):
        log.debug(json_dict)
        if json_dict["type"] != "event":
            return

        error_type = json_dict["event"]
        if error_type not in ["syntaxDiag", "semanticDiag"]:
            return

        body = json_dict["body"]
        if body is not None:
            file = body["file"]
            if file not in self.errors:
                self.errors[file] = {"syntaxDiag": [], "semanticDiag": []}
            self.errors[file][error_type] = []
            diags = body["diagnostics"]
            for diag in diags:
                message = "    ({0}, {1}) {2}".format(
                    diag["start"]["line"],
                    diag["start"]["offset"],
                    diag["text"]
                    )
                self.errors[file][error_type].append(message)
            self.set_update_error_list_panel_timer(100)
            
    def set_update_error_list_panel_timer(self, ms):
        self.pending_update_error_list_panel += 1
        sublime.set_timeout(self.handle_update_error_list_panel, ms)

    def handle_update_error_list_panel(self):
        self.pending_update_error_list_panel -= 1
        if self.pending_update_error_list_panel == 0:
            self.update_error_list_panel()
    
    def update_error_list_panel(self):
        log.debug("update error list panel")
        output_lines = []
        output_line_map = dict()

        for file in self.errors:
            start_line_number = len(output_lines)
            error_count = len(self.errors[file]["syntaxDiag"]) + len(self.errors[file]["semanticDiag"])
            if error_count > 0:
                output_lines.append("{0} [{1} errors]".format(file, error_count))
                output_lines.extend(self.errors[file]["syntaxDiag"] + self.errors[file]["semanticDiag"])
                for cur_line_number in range(start_line_number, len(output_lines)):
                    matches = re.findall("(?:\((\d+), (\d+)\))", output_lines[cur_line_number])
                    if len(matches) > 0:
                        row, col = matches[0]
                        output_line_map[cur_line_number] = (file, row, col)

        if len(output_lines) == 0:
            output_lines = ["No error found in this project."]
            # remove the gutter icon
            get_panel_manager().get_panel("errorlist").erase_regions("cur_error")

        get_panel_manager().write_lines_to_panel("errorlist", output_lines)
        get_panel_manager().set_line_map("errorlist", output_line_map)

    def request_errors(self, view, info, error_delay):
        if not self.event_handler_added:
            cli.service.add_event_handler_for_worker("syntaxDiag", self.load_error)
            cli.service.add_event_handler_for_worker("semanticDiag", self.load_error)
            self.event_handler_added = True

        if info and self.is_error_list_panel_active() and (
            self.just_changed_focus or
            self.modified
        ):
            self.just_changed_focus = False
            self.modified = False
            cli.service.request_get_err_for_project(error_delay, view.file_name())

listener = ProjectErrorListener()

def start_timer():
    global listener
    listener.just_changed_focus = True
    listener.set_request_error_timer(50)

EventHub.subscribe("on_activated_with_info", listener.on_activated_with_info)
EventHub.subscribe("post_on_modified", listener.post_on_modified)