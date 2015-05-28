import sublime_plugin
import sublime
import os
from ..libs.global_vars import IS_ST2


class TypescriptBuildCommand(sublime_plugin.WindowCommand):
    def run(self):
        file_name = self.window.active_view().file_name()
        directory = os.path.dirname(file_name)
        if "tsconfig.json" in os.listdir(directory):
            self.window.run_command("exec", {
                "cmd": "tsc",
                "file_regex": "^(.+?)\\((\\d+),(\\d+)\\): (.+)$",
                "shell": True
            })
        else:
            sublime.active_window().show_input_panel(
                "Build parameters: ",
                "",  # initial text
                self.compile_inferred_project,
                None,  # on change
                None   # on cancel
            )

    def compile_inferred_project(self, params=""):
        file_name = self.window.active_view().file_name()
        if not IS_ST2:
            cmd = "tsc {0} {1}".format(file_name, params)
            self.window.run_command("exec", {
                "shell_cmd": cmd,
                "file_regex": "^(.+?)\\((\\d+),(\\d+)\\): (.+)$"
            })
        else:
            cmd = "tsc {0} {1}".format(file_name, params)
            self.window.run_command("exec", {
                "cmd": [cmd],
                "file_regex": "^(.+?)\\((\\d+),(\\d+)\\): (.+)$",
                "shell": True
            })
