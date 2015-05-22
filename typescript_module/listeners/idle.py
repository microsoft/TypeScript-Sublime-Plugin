from typescript_module.libs.view_helpers import *
from typescript_module.libs.text_helpers import *
from typescript_module.libs import log
from typescript_module.listeners.event_hub import EventHub


class IdleListener:
    def __init__(self):
        self.change_focus = False
        self.pending_timeout = 0
        self.pending_selection_timeout = 0
        self.error_refresh_requested = False
        self.modified = False
        self.wait_count = 0

    def on_activated_with_info(self, view, info):
        # Ask server for initial error diagnostics
        self.refresh_errors(view, info, 200)

        # set modified and selection idle timers, so we can read
        # diagnostics and update
        # status line
        self.set_on_idle_timer(IDLE_TIME_LENGTH)
        self.set_on_selection_idle_timer(IDLE_TIME_LENGTH)
        self.change_focus = True

    def post_on_modified(self, view):
        if not is_special_view(view):
            self.modified = True
            self.set_on_idle_timer(100)

    def on_selection_modified_with_info(self, view, info):
        if self.modified:
            # Todo: explain magic number
            self.set_on_selection_idle_timer(1250)
        else:
            # Todo: explain magic number
            self.set_on_selection_idle_timer(50)
        self.modified = False

    def refresh_errors(self, view, info, error_delay):
        """
        Ask the server for diagnostic information on all opened ts files in
        most-recently-used order
        """
        # Todo: limit this request to ts files currently visible in views
        if info and (self.change_focus or info.change_count_err_req < change_count(view)):
            self.change_focus = False
            info.change_count_err_req = change_count(view)
            window = sublime.active_window()
            num_groups = window.num_groups()
            files = []
            for i in range(num_groups):
                group_active_view = window.active_view_in_group(i)
                info = get_info(group_active_view)
                if info:
                    files.append(group_active_view.file_name())
                    check_update_view(group_active_view)
            if len(files) > 0:
                cli.service.request_get_err(error_delay, files)
            self.error_refresh_requested = True
            self.wait_count = 0
            self.set_on_idle_timer(error_delay + 300)

    def show_error_msgs(self, diagno_event_body, syntactic):
        """
        Error messages arrived from the server; show them in view
        """
        filename = diagno_event_body["file"]
        if (os.name == 'nt') and filename:
            filename = filename.replace('/', '\\')
        diagnos = diagno_event_body["diagnostics"]
        info = get_info_with_filename(filename)
        if info:
            view = info.view
            if not info.change_count_err_req == change_count(view):
                self.set_on_idle_timer(200)
            else:
                region_key = 'syntacticDiag' if syntactic else 'semanticDiag'
                view.erase_regions(region_key)
                client_info = cli.get_or_add_file(filename)
                client_info.errors[region_key] = []
                error_regions = []
                if diagnos:
                    for diagno in diagnos:
                        start_location = diagno["start"]
                        end_location = diagno["end"]
                        line, offset = extract_line_offset(start_location)
                        end_line, end_offset = extract_line_offset(end_location)
                        text = diagno["text"]
                        start = view.text_point(line, offset)
                        end = view.text_point(end_line, end_offset)
                        if end <= view.size():
                            region = sublime.Region(start, end)
                            error_regions.append(region)
                            client_info.errors[region_key].append((region, text))
                info.has_errors = cli.has_errors(filename)
                self.update_status(view, info)
                if IS_ST2:
                    view.add_regions(region_key, error_regions, "keyword", "", sublime.DRAW_OUTLINED)
                else:
                    view.add_regions(region_key, error_regions, "keyword", "",
                                     sublime.DRAW_NO_FILL + sublime.DRAW_NO_OUTLINE + sublime.DRAW_SQUIGGLY_UNDERLINE)

    def dispatch_event(self, ev):
        event_type = ev["event"]
        if event_type == 'syntaxDiag':
            self.show_error_msgs(ev["body"], syntactic=True)
        elif event_type == 'semanticDiag':
            self.show_error_msgs(ev["body"], syntactic=False)

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

        If file hasn't been modified for a time check the event
        queue and dispatch any events.
        """
        log.debug("enter on_idle")
        view = active_view()
        log.debug("call get_event from on_idle")
        ev = cli.service.get_event()
        if ev is not None:
            self.error_refresh_requested = False
            self.dispatch_event(ev)
            # reset the timer in case more events are on the queue
            self.set_on_idle_timer(50)
        elif self.error_refresh_requested:
            # if the last request takes too long we'll abandon it
            # to prevent infinite loop
            self.wait_count += 1
            if self.wait_count >= 20:
                self.error_refresh_requested = False
                self.wait_count = 0
            # reset the timer if we haven't gotten an event
            # since the last time errors were requested
            self.set_on_idle_timer(50)

        info = get_info(view)
        if info:
            log.debug("asking for errors")
            # request errors
            self.refresh_errors(view, info, 500)

    def update_status(self, view, info):
        """Update the status line with error info and quick info if no error info"""
        log.debug("call get_event from update_status")
        ev = cli.service.get_event()
        if ev is not None:
            self.error_refresh_requested = False
            self.dispatch_event(ev)

        if info.has_errors:
            view.run_command('typescript_error_info')
        else:
            view.erase_status("typescript_error")

        error_status = view.get_status('typescript_error')
        if error_status and len(error_status) > 0:
            view.erase_status("typescript_info")
        else:
            view.run_command('typescript_quick_info')


listener = IdleListener()
EventHub.subscribe("on_activated_with_info", listener.on_activated_with_info)
EventHub.subscribe("post_on_modified", listener.post_on_modified)
EventHub.subscribe("on_selection_modified_with_info", listener.on_selection_modified_with_info)