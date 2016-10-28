import sublime_plugin

from ..libs.global_vars import *
from ..libs import cli


class TypescriptBuildCommand(sublime_plugin.WindowCommand):
    build_parameters = ""
    
    def run(self):
        if get_node_path() is None:
            print("Cannot find node. Build cancelled.")
            return

        file_name = self.window.active_view().file_name()
        project_info = cli.service.project_info(file_name)
        if project_info["success"]:
            body = project_info["body"]
            if ("configFileName" in body) and body["configFileName"].endswith(".json"):
                tsconfig_dir = dirname(project_info["body"]["configFileName"])
                self.window.run_command("exec", {
                    "cmd": [get_node_path(), get_tsc_path(), "-p", tsconfig_dir],
                    # regex to capture build result for displaying in the output panel
                    "file_regex": "^(.+?)\\((\\d+),(\\d+)\\): (.+)$"
                })
            else:
                sublime.active_window().show_input_panel(
                    "Build parameters: ",
                    TypescriptBuildCommand.build_parameters, # initial text
                    lambda params: self.compile_inferred_project(file_name, params),
                    None,  # on change
                    None   # on cancel
                )

    def compile_inferred_project(self, file_name, params=""):
        cmd = [get_node_path(), get_tsc_path(), file_name]
        print(cmd)
        if params != "":
            cmd.extend(params.split(' '))
        self.window.run_command("exec", {
            "cmd": cmd,
            "file_regex": "^(.+?)\\((\\d+),(\\d+)\\): (.+)$"
        })
        TypescriptBuildCommand.build_parameters = params
