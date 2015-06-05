import sublime_plugin

from ..libs.global_vars import *
from ..libs import cli


class TypescriptBuildCommand(sublime_plugin.WindowCommand):
    def run(self):
        if get_node_path() is None:
            print("Cannot found node. Build cancelled.")
            return

        file_name = self.window.active_view().file_name()
        project_info = cli.service.project_info(file_name)
        if project_info["success"]:
            if "configFileName" in project_info["body"]:
                tsconfig_dir = dirname(project_info["body"]["configFileName"])
                self.window.run_command("exec", {
                    "cmd": [get_node_path(), TSC_PATH, "-p", tsconfig_dir],
                    "file_regex": "^(.+?)\\((\\d+),(\\d+)\\): (.+)$"
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
        cmd = [get_node_path(), TSC_PATH, file_name]
        print(cmd)
        if params != "":
            cmd.extend(params.split(' '))
        self.window.run_command("exec", {
            "cmd": cmd,
            "file_regex": "^(.+?)\\((\\d+),(\\d+)\\): (.+)$"
        })
