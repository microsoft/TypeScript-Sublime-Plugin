from .event_hub import EventHub
from ..libs.view_helpers import *
from ..libs.logger import log
from ..libs import cli

class FormatEventListener:
    def on_post_text_command_with_info(self, view, command_name, args, info):
        if command_name in \
            ["typescript_format_on_key",
             "typescript_format_document",
             "typescript_format_selection",
             "typescript_format_line",
             "typescript_paste_and_format"]:
            print("handled changes for " + command_name)

    def on_modified_with_info(self, view, info):
        log.debug("Format on key")

        if (
            is_typescript(view) and
            cli.ts_auto_format_enabled and
            info.prev_sel and
            len(info.prev_sel) == 1 and
            info.prev_sel[0].empty()
        ):
            last_command, args, repeat_times = view.command_history(0)
            redo_command = view.command_history(1)[0]
            log.debug("last_command:{0}, args:{1}".format(last_command, args))
            log.debug("redo_command:{0}".format(redo_command))
            if redo_command != "" and redo_command is not None:
                # in an undo session, avoid running format_on_key. For
                # a non-undo session in ST3, the redo_command is an empty 
                # string; in ST2, the redo_command is None
                return 

            if last_command == "insert":
                pos = info.prev_sel[0].begin()
                if ";" in args["characters"]:
                    view.run_command("typescript_format_on_key", {"key": ";"})
                if "}" in args["characters"]:
                    if cli.auto_match_enabled:
                        prev_char = view.substr(pos - 1)
                        post_char = view.substr(pos + 1)
                        log.debug("prev_char: {0}, post_char: {1}".format(prev_char, post_char))
                        if prev_char != "{" and post_char != "}":
                            view.run_command("typescript_format_on_key", {"key": "}"})
                    else:
                        view.run_command("typescript_format_on_key", {"key": "}"})
                if "\n" in args["characters"]:
                    if cli.ts_auto_indent_enabled and view.score_selector(pos, "meta.scope.between-tag-pair") > 0:
                        view.run_command("typescript_format_on_key", {"key": "\n"})

listener = FormatEventListener()
EventHub.subscribe("on_post_text_command_with_info", listener.on_post_text_command_with_info)
EventHub.subscribe("on_modified_with_info", listener.on_modified_with_info)