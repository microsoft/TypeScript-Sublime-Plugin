import sublime_plugin

from ..libs.view_helpers import *
from ..libs import *
from .event_hub import EventHub

class TypeScriptEventListener(sublime_plugin.EventListener):
    """To avoid duplicated behavior among event listeners"""

    # During the "close all" process, handling on_activated events is
    # undesirable (not required and can be costly due to reloading buffers).
    # This flag provides a way to know whether the "close all" process is
    # happening so we can ignore unnecessary on_activated callbacks.
    about_to_close_all = False

    def on_activated(self, view):
        log.debug("on_activated")

        if TypeScriptEventListener.about_to_close_all:
            return

        if is_special_view(view):
            self.on_activated_special_view(view)
        else:
            info = get_info(view)
            if info:
                self.on_activated_with_info(view, info)

    def on_activated_special_view(self, view):
        log.debug("on_activated_special_view")
        EventHub.run_listeners("on_activated_special_view", view)

    def on_activated_with_info(self, view, info):
        log.debug("on_activated_with_info")
        EventHub.run_listeners("on_activated_with_info", view, info)

    def on_modified(self, view):
        """
        Usually called by Sublime when the buffer is modified
        not called for undo, redo
        """
        log.debug("on_modified")
        if is_special_view(view):
            self.on_modified_special_view(view)
        else:
            info = get_info(view)
            if info:
                self.on_modified_with_info(view, info)
        self.post_on_modified(view)

    def on_modified_special_view(self, view):
        log.debug("on_modified_special_view")
        EventHub.run_listeners("on_modified_special_view", view)

    def on_modified_with_info(self, view, info):
        log.debug("on_modified_with_info")

        # A series state-updating for the info object to sync the file content on the server
        info.modified = True

        # Todo: explain
        if IS_ST2:
            info.modify_count += 1
        info.last_modify_change_count = change_count(view)
        last_command, args, repeat_times = view.command_history(0)

        if info.pre_change_sent:
            # change handled in on_text_command
            info.client_info.change_count = change_count(view)
            info.pre_change_sent = False

        else:
            if last_command == "insert":
                if (
                    "\n" not in args['characters']  # no new line inserted
                    and info.prev_sel  # it is not a newly opened file
                    and len(info.prev_sel) == 1  # not a multi-cursor session
                    and info.prev_sel[0].empty()  # the last selection is not a highlighted selection
                    and not info.client_info.pending_changes  # no pending changes in the buffer
                ):
                    info.client_info.change_count = change_count(view)
                    prev_cursor = info.prev_sel[0].begin()
                    cursor = view.sel()[0].begin()
                    key = view.substr(sublime.Region(prev_cursor, cursor))
                    send_replace_changes_for_regions(view, static_regions_to_regions(info.prev_sel), key)
                    # mark change as handled so that on_post_text_command doesn't try to handle it
                    info.change_sent = True
                else:
                    # request reload because we have strange insert
                    info.client_info.pending_changes = True

            # Reload buffer after insert_snippet.
            # For Sublime 2 only. In Sublime 3, this logic is implemented in
            # on_post_text_command callback.
            # Issue: https://github.com/Microsoft/TypeScript-Sublime-Plugin/issues/277
            if IS_ST2 and last_command == "insert_snippet":
                reload_buffer(view);

        # Other listeners
        EventHub.run_listeners("on_modified_with_info", view, info)

    def post_on_modified(self, view):
        log.debug("post_on_modified")
        EventHub.run_listeners("post_on_modified", view)

    def on_selection_modified(self, view):
        """
        Called by Sublime when the cursor moves (or when text is selected)
        called after on_modified (when on_modified is called)
        """
        log.debug("on_selection_modified")
        # Todo: why do we only check this here? anyway to globally disable the listener for non-ts files
        if not is_typescript(view):
            return

        EventHub.run_listeners("on_selection_modified", view)

        info = get_info(view)
        if info:
            self.on_selection_modified_with_info(view, info)

    def on_selection_modified_with_info(self, view, info):
        log.debug("on_selection_modified_with_info")
        if not info.client_info:
            info.client_info = cli.get_or_add_file(view.file_name())

        if (
            info.client_info.change_count < change_count(view)
            and info.last_modify_change_count != change_count(view)
        ):
            # detected a change to the view for which Sublime did not call
            # 'on_modified' and for which we have no hope of discerning
            # what changed
            info.client_info.pending_changes = True
        # save the current cursor position so that we can see (in
        # on_modified) what was inserted
        info.prev_sel = regions_to_static_regions(view.sel())

        EventHub.run_listeners("on_selection_modified_with_info", view, info)

    def on_load(self, view):
        log.debug("on_load")
        EventHub.run_listeners("on_load", view)

    def on_window_command(self, window, command_name, args):
        log.debug("on_window_command")

        if command_name == "hide_panel" and cli.worker_client.started():
            cli.worker_client.stop()

        elif command_name == "exit":
            cli.service.exit()

        elif command_name in ["close_all", "close_window", "close_project"]:
            # Only set <about_to_close_all> flag if there exists at least one
            # view in the active window. This is important because we need
            # some view's on_close callback to reset the flag.
            window = sublime.active_window()
            if window is not None and window.views():
                TypeScriptEventListener.about_to_close_all = True

    def on_text_command(self, view, command_name, args):
        """
        ST3 only (called by ST3 for some, but not all, text commands)
        for certain text commands, learn what changed and notify the
        server, to avoid sending the whole buffer during completion
        or when key can be held down and repeated.
        If we had a popup session active, and we get the command to
        hide it, then do the necessary clean up.
        """
        log.debug("on_text_command")
        EventHub.run_listeners("on_text_command", view, command_name, args)
        info = get_info(view)
        if info:
            self.on_text_command_with_info(view, command_name, args, info)

    def on_text_command_with_info(self, view, command_name, args, info):
        log.debug("on_text_command_with_info")
        info.change_sent = True
        info.pre_change_sent = True
        if command_name == "left_delete":
            # backspace
            send_replace_changes_for_regions(view, left_expand_empty_region(view.sel()), "")
        elif command_name == "right_delete":
            # delete
            send_replace_changes_for_regions(view, right_expand_empty_region(view.sel()), "")
        else:
            # notify on_modified and on_post_text_command events that
            # nothing was handled. There are multiple flags because Sublime
            # does not always call all three events.
            info.pre_change_sent = False
            info.change_sent = False
            info.modified = False

        EventHub.run_listeners("on_text_command_with_info", view, command_name, args, info)

    def on_post_text_command(self, view, command_name, args):
        """
        ST3 only
        called by ST3 for some, but not all, text commands
        not called for insert command
        """
        log.debug("on_post_text_command")
        info = get_info(view)
        if info:
            if not info.change_sent and info.modified:
                self.on_post_text_command_with_info(view, command_name, args, info)

                # we are up-to-date because either change was sent to server or
                # whole buffer was sent to server
                info.client_info.change_count = view.change_count()
            # reset flags and saved regions used for communication among
            # on_text_command, on_modified, on_selection_modified,
            # on_post_text_command, and on_query_completion
            info.change_sent = False
            info.modified = False
            info.completion_sel = None

    def on_post_text_command_with_info(self, view, command_name, args, info):
        log.debug("on_post_text_command_with_info")
        if command_name not in \
            ["commit_completion",
             "insert_best_completion",
             "typescript_format_on_key",
             "typescript_format_document",
             "typescript_format_selection",
             "typescript_format_line",
             "typescript_paste_and_format"]:
            print(command_name)
            # give up and send whole buffer to server (do this eagerly
            # to avoid lag on next request to server)
            reload_buffer(view, info.client_info)
        EventHub.run_listeners("on_post_text_command_with_info", view, command_name, args, info)

    def on_query_completions(self, view, prefix, locations):
        log.debug("on_query_completions")
        return EventHub.run_listener_with_return("on_query_completions", view, prefix, locations)

    def on_query_context(self, view, key, operator, operand, match_all):
        log.debug("on_query_context")
        return EventHub.run_listener_with_return("on_query_context", view, key, operator, operand, match_all)

    def on_close(self, view):
        log.debug("on_close")
        file_name = view.file_name()
        info = get_info(view, open_if_not_cached=False)
        if info:
            info.is_open = False
        if view.is_scratch() and view.name() == "Find References":
            cli.dispose_ref_info()
        else:
            # info = get_info(view)
            # if info:
            #     if info in most_recent_used_file_list:
            #         most_recent_used_file_list.remove(info)
            # notify the server that the file is closed
            cli.service.close(file_name)

        # If this is the last view that is closed by a close_all command,
        # reset <about_to_close_all> flag.
        if TypeScriptEventListener.about_to_close_all:
            window = sublime.active_window()
            if window is None or not window.views():
                TypeScriptEventListener.about_to_close_all = False
                log.debug("all views have been closed")

    def on_pre_save(self, view):
        log.debug("on_pre_save")
        check_update_view(view)

    def on_hover(self, view, point, hover_zone):
        log.debug("on_hover")
        EventHub.run_listeners("on_hover", view, point, hover_zone)