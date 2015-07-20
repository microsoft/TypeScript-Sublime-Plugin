from ..libs.view_helpers import *
from ..libs.text_helpers import *
from ..libs import log
from .event_hub import EventHub


class IdleListener:
    def __init__(self):
        self.just_changed_focus = False
        self.pending_timeout = 0
        self.pending_selection_timeout = 0
        self.modified = False
        self.event_handler_added = False

    def on_activated_with_info(self, view, info):
        # set modified and selection idle timers, so we can read
        # diagnostics and update status line
        self.set_on_idle_timer(IDLE_TIME_LENGTH)
        self.set_on_selection_idle_timer(IDLE_TIME_LENGTH)
        self.just_changed_focus = True

    def post_on_modified(self, view):
        if not is_special_view(view):
            self.modified = True
            self.set_on_idle_timer(100)

    def on_selection_modified_with_info(self, view, info):
        if self.modified:
            self.set_on_selection_idle_timer(1250)
        else:
            self.set_on_selection_idle_timer(100)
        self.modified = False

    def request_errors(self, view, info, error_delay):
        """
        Ask the server for diagnostic information on all opened ts files in
        most-recently-used order
        """
        if not self.event_handler_added:
            cli.service.add_event_handler("syntaxDiag", lambda ev: self.show_errors(ev["body"], syntactic=True))
            cli.service.add_event_handler("semanticDiag", lambda ev: self.show_errors(ev["body"], syntactic=False))
            self.event_handler_added = True

        # Todo: limit this request to ts files currently visible in views
        if info and (self.just_changed_focus or info.change_count_when_last_err_req_sent < change_count(view)):
            self.just_changed_focus = False
            info.change_count_when_last_err_req_sent = change_count(view)
            window = sublime.active_window()
            group_number = window.num_groups()
            files = []
            for i in range(group_number):
                group_active_view = window.active_view_in_group(i)
                info = get_info(group_active_view)
                if info:
                    files.append(group_active_view.file_name())
                    check_update_view(group_active_view)
            if len(files) > 0:
                cli.service.request_get_err(error_delay, files)

    def show_errors(self, diagno_event_body, syntactic):
        """
        Error messages arrived from the server; show them in view
        """
        log.debug("show_errors")
        filename = diagno_event_body["file"]
        if os.name == 'nt' and filename:
            filename = filename.replace('/', '\\')

        info = get_info_with_filename(filename)
        if not info:
            return

        view = info.view
        if not info.change_count_when_last_err_req_sent == change_count(view):
            log.debug("The error info is outdated")
            self.set_on_idle_timer(200)
            return

        region_key = 'syntacticDiag' if syntactic else 'semanticDiag'
        view.erase_regions(region_key)

        client_info = cli.get_or_add_file(filename)
        client_info.errors[region_key] = []
        error_regions = []

        diagnos = diagno_event_body["diagnostics"]
        if diagnos:
            for diagno in diagnos:
                start_line, start_offset = extract_line_offset(diagno["start"])
                start = view.text_point(start_line, start_offset)

                end_line, end_offset = extract_line_offset(diagno["end"])
                end = view.text_point(end_line, end_offset)

                if end <= view.size():
                    # Creates a <sublime.Region> from <start> to <end> to
                    # highlight the error. If the region coincides with the
                    # EOF character, use the region of the last visible
                    # character instead so user can still see the highlight.
                    if start == view.size() and start == end:
                        region = last_visible_character_region(view)
                    else:
                        region = sublime.Region(start, end)

                    client_info.errors[region_key].append((region, diagno["text"]))
                    error_regions.append(region)

        # Update status bar with error information
        info.has_errors = cli.has_errors(filename)
        self.update_status(view, info)

        # Highlight error regions in view
        if IS_ST2:
            view.add_regions(region_key, error_regions, "keyword", "",
                             sublime.DRAW_OUTLINED)
        else:
            view.add_regions(region_key, error_regions, "keyword", "",
                             sublime.DRAW_NO_FILL +
                             sublime.DRAW_NO_OUTLINE +
                             sublime.DRAW_SQUIGGLY_UNDERLINE)

    def set_on_selection_idle_timer(self, ms):
        """Set timer to go off when selection is idle"""
        self.pending_selection_timeout += 1
        sublime.set_timeout(self.handle_selection_time_out, ms)

    def handle_selection_time_out(self):
        self.pending_selection_timeout -= 1
        if self.pending_selection_timeout == 0:
            self.on_selection_idle()

    def on_selection_idle(self):
        """
        If selection is idle (cursor is not moving around)
        update the status line (error message or quick info, if any)
        """
        log.debug("on_selection_idle")
        view = active_view()
        info = get_info(view)
        if info:
            self.update_status(view, info)

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
        """Callback after the idle status is confirmed

        If file hasn't been modified for a time check the need to request errors
        """
        log.debug("on_idle")
        view = active_view()
        info = get_info(view)
        if info:
            log.debug("asking for errors")
            # request errors
            self.request_errors(view, info, 500)

    def update_status(self, view, info):
        """Update the status line with error info and quick info if no error info"""
        # Error info
        if info.has_errors:
            view.run_command('typescript_error_info')
        else:
            view.erase_status("typescript_error")

        # Quick info
        error_status = view.get_status('typescript_error')
        if error_status and len(error_status) > 0:
            view.erase_status("typescript_info")
        else:
            view.run_command('typescript_quick_info')


listener = IdleListener()
EventHub.subscribe("on_activated_with_info", listener.on_activated_with_info)
EventHub.subscribe("post_on_modified", listener.post_on_modified)
EventHub.subscribe("on_selection_modified_with_info", listener.on_selection_modified_with_info)