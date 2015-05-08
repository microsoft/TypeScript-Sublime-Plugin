import sublime_plugin

from ..libs.viewhelpers import *
from ..libs.texthelpers import *


class CompletionEventListener(sublime_plugin.EventListener):
    def __init__(self):
        self.completions_ready = False
        self.completions_loc = None
        # Used to check if the completion is out of date
        self.completion_request_seq = None
        self.completion_request_prefix = None
        self.completion_request_loc = None
        self.if_completion_request_member = False
        self.completion_view = None
        self.pending_completions = []


    def on_query_completions(self, view, prefix, locations):
        """
        Note: synchronous for now; can change to async by adding hide/show from the handler
        """
        info = get_info(view)
        if info:
            info.completion_prefix_sel = decrease_locs_to_regions(locations, len(prefix))
            if not IS_ST2:
                view.add_regions("apresComp", decrease_locs_to_regions(locations, 0), flags=sublime.HIDDEN)

            if (not self.completions_ready) or IS_ST2:
                location = get_location_from_position(view, locations[0])
                check_update_view(view)
                if IS_ST2:
                    # Send synchronous request for Sublime Text 2
                    cli.service.completions(view.file_name(), location, prefix, self.handle_completion_info)
                else:
                    # Send asynchronous request for Sublime Text 3
                    # 'locations' is an array because of multiple cursor support
                    self.completion_request_loc = locations[0]
                    self.completion_request_prefix = prefix
                    self.completion_request_seq = cli.service.seq
                    if locations[0] > 0:
                        prev_char = view.substr(sublime.Region(locations[0] - 1, locations[0] - 1))
                        self.if_completion_request_member = (prev_char == ".")
                    else:
                        self.if_completion_request_member = False
                    cli.service.async_completions(view.file_name(), location, prefix, self.handle_completion_info)

            completions = self.pending_completions
            info.last_completion_loc = locations[0]
            self.pending_completions = []
            self.completions_ready = False
            return completions, sublime.INHIBIT_WORD_COMPLETIONS | sublime.INHIBIT_EXPLICIT_COMPLETIONS


    def run_auto_complete(self):
        active_view().run_command("auto_complete", {
            'disable_auto_insert': True,
            'api_completions_only': True,
            'next_completion_if_showing': False,
            'auto_complete_commit_on_tab': True,
        })


    def handle_completion_info(self, completions_resp):
        """Helper callback when completion info received from server"""
        self.pending_completions = []
        if not IS_ST2:
            view = active_view()
            loc = view.sel()[0].begin()
            prefix_length = len(self.completion_request_prefix)
            # Get the current content from the starting location to the cursor location
            cur_str = view.substr(sublime.Region(self.completion_request_loc - prefix_length, loc))
            if not cur_str.startswith(self.completion_request_prefix):
                # Changed content indicates outdated completion
                return
            if "." in cur_str:
                if not self.if_completion_request_member:
                    print(cur_str + " includes a dot but not req mem")
                    return
            if len(cur_str) > 0 and not VALID_COMPLETION_ID_PATTERN.match(cur_str):
                return

        if completions_resp["success"] and (completions_resp["request_seq"] == self.completion_request_seq or IS_ST2):
            completions = []
            raw_completions = completions_resp["body"]
            if raw_completions:
                for raw_completion in raw_completions:
                    name = raw_completion["name"]
                    completion = (name + "\t" + raw_completion["kind"], name.replace("$", "\\$"))
                    completions.append(completion)
                self.pending_completions = completions
            if not IS_ST2:
                self.completions_ready = True
                active_view().run_command('hide_auto_complete')
                self.run_auto_complete()