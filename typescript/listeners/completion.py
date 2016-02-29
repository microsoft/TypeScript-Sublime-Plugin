import sublime

from ..libs.view_helpers import *
from ..libs.text_helpers import *
from .event_hub import EventHub


class CompletionEventListener:
    def __init__(self):
        self.completions_ready = False
        self.completions_loc = None
        # Used to check if the completion is out of date
        self.completion_request_seq = None
        self.completion_request_prefix = None
        self.completion_request_loc = None
        self.if_completion_request_member = False
        self.pending_completions = []
        self.modified = False

    def on_activated_with_info(self, view, info):
        info.last_completion_loc = None
        # save cursor in case we need to read what was inserted
        info.prev_sel = regions_to_static_regions(view.sel())

    def on_text_command_with_info(self, view, command_name, args, info):
        if command_name in ["commit_completion", "insert_best_completion"]:
            # for finished completion, remember current cursor and set
            # a region that will be moved by the inserted text
            info.completion_sel = copy_regions(view.sel())
            view.add_regions(
                "apresComp",
                copy_regions(view.sel()),
                flags=sublime.HIDDEN
            )

    def on_modified_with_info(self, view, info):
        self.modified = True

    def on_selection_modified_with_info(self, view, info):
        if self.modified:
            # backspace past start of completion
            if info.last_completion_loc and info.last_completion_loc > view.sel()[0].begin():
                view.run_command('hide_auto_complete')
        self.modified = False

    def on_post_text_command_with_info(self, view, command_name, args, info):
        if not info.change_sent and info.modified:
            # file is modified but on_text_command and on_modified did not
            # handle it
            # handle insertion of string from completion menu, so that
            # it is fast to type completedName1.completedName2 (avoid a lag
            # when completedName1 is committed)
            if command_name in ["commit_completion", "insert_best_completion"] and \
                    len(view.sel()) == 1 and \
                    not info.client_info.pending_changes:
                # get saved region that was pushed forward by insertion of
                # the completion
                apres_comp_region = view.get_regions("apresComp")
                # note: assuming sublime makes all regions empty for
                # completion -- which the doc claims is true,
                # the insertion string is from region saved in
                # on_query_completion to region pushed forward by
                # completion insertion
                insertion_string = view.substr(
                    sublime.Region(info.completion_prefix_sel[0].begin(), apres_comp_region[0].begin()))
                send_replace_changes_for_regions(
                    view,
                    build_replace_regions(
                        info.completion_prefix_sel,
                        info.completion_sel
                    ),
                    insertion_string)
                view.erase_regions("apresComp")
                info.last_completion_loc = None

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

    def run_auto_complete(self):
        active_view().run_command("auto_complete", {
            'disable_auto_insert': True,
            'api_completions_only': False,
            'next_completion_if_showing': False,
            'auto_complete_commit_on_tab': True,
        })

listener = CompletionEventListener()
EventHub.subscribe("on_query_completions", listener.on_query_completions)
EventHub.subscribe("on_activated_with_info", listener.on_activated_with_info)
EventHub.subscribe("on_text_command_with_info", listener.on_text_command_with_info)
EventHub.subscribe("on_modified_with_info", listener.on_modified_with_info)
EventHub.subscribe("on_selection_modified_with_info", listener.on_selection_modified_with_info)
EventHub.subscribe("on_post_text_command_with_info", listener.on_post_text_command_with_info)