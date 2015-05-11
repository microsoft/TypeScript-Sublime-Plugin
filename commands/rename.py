import sublime_plugin

from ..libs import *
from ..libs.viewhelpers import *
from ..libs.reference import *


class TypescriptRenameCommand(sublime_plugin.TextCommand):
    """Rename command"""
    def run(self, text):
        if not is_typescript(self.view):
            print("To run this command, please first assign a file name to the view")
            return
        check_update_view(self.view)
        rename_response = cli.service.rename(self.view.file_name(), get_location_from_view(self.view))
        if rename_response["success"]:
            info_locations = rename_response["body"]
            # Todo: handle error when the symbol cannot be renamed (with 'localizedErrorMessage' property)
            display_name = info_locations["info"]["fullDisplayName"]
            outer_locations = info_locations["locs"]

            def on_cancel():
                return

            def on_done(new_name):
                args = {"newName": new_name, "outerLocs": outer_locations}
                args_json_str = jsonhelpers.encode(args)
                self.view.run_command('typescript_finish_rename', {"args_json": args_json_str})

            if len(outer_locations) > 0:
                sublime.active_window().show_input_panel(
                    "New name for {0}: ".format(display_name),
                    info_locations["info"]["displayName"],
                    on_done, None, on_cancel
                )


class TypescriptFinishRenameCommand(sublime_plugin.TextCommand):
    """
    Called from on_done handler in finish_rename command
    on_done is called by input panel for new name
    """
    def run(self, text, args_json=""):
        args = jsonhelpers.decode(args_json)
        new_name = args["newName"]
        outer_locations = args["outerLocs"]
        if len(outer_locations) > 0:
            for outerLoc in outer_locations:
                file = outerLoc["file"]
                inner_locations = outerLoc["locs"]
                active_window = sublime.active_window()
                rename_view = active_window.find_open_file(file)
                if not rename_view:
                    # File not loaded but on disk
                    client_info = cli.get_or_add_file(file)
                    client_info.rename_on_load = {"locs": inner_locations, "name": new_name}
                    active_window.open_file(file)
                elif rename_view != self.view:
                    # File opened but not current one
                    rename_view.run_command('typescript_delayed_rename_file',
                                           {"locs_name": {"locs": inner_locations, "name": new_name}})
                else:
                    for inner_location in inner_locations:
                        start_location = inner_location["start"]
                        start_line, start_offset = extract_line_offset(start_location)
                        end_location = inner_location["end"]
                        end_line, end_offset = extract_line_offset(end_location)
                        apply_edit(text, self.view, start_line, start_offset, end_line,
                                   end_offset, ntext=new_name)


class TypescriptDelayedRenameFile(sublime_plugin.TextCommand):
    # Rename in 'on_load' method
    def run(self, text, locs_name=None):
        if locs_name['locs'] and (len(locs_name['name']) > 0):
            locs = locs_name['locs']
            name = locs_name['name']
            for innerLoc in locs:
                startlc = innerLoc['start']
                (startl, startc) = extract_line_offset(startlc)
                endlc = innerLoc['end']
                (endl, endc) = extract_line_offset(endlc)
                apply_edit(text, self.view, startl, startc, endl,
                           endc, ntext=name)
