from .eventhub import EventHub


class FormatEventListener:
    def on_post_text_command_with_info(self, view, command_name, args, info):
        if command_name in \
            ["typescript_format_on_key",
             "typescript_format_document",
             "typescript_format_selection",
             "typescript_format_line",
             "typescript_paste_and_format"]:
            print("handled changes for " + command_name)

listener = FormatEventListener()
EventHub.subscribe("on_query_completions", listener.on_post_text_command_with_info)