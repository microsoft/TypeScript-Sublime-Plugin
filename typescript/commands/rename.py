from ..libs import *
from ..libs.view_helpers import *
from ..libs.reference import *
from .base_command import TypeScriptBaseTextCommand


class TypescriptRenameCommand(TypeScriptBaseTextCommand):
    """
    Command to rename identifier
    """
    def run(self, text):
        check_update_view(self.view)

        rename_response = cli.service.rename(self.view.file_name(), get_location_from_view(self.view))
        if not rename_response['success']:
            return

        body = rename_response['body']

        info = body['info']
        if not info['canRename']:
            self.view.set_status('typescript_error', info['localizedErrorMessage'])
            return

        display_name = info['fullDisplayName']
        outer_locations = body['locs']

        def on_done(new_name):
            args = {'newName': new_name, 'outerLocs': outer_locations}
            args_json_str = json_helpers.encode(args)
            self.view.run_command('typescript_finish_rename', {'args_json': args_json_str})

        if len(outer_locations) > 0:
            sublime.active_window().show_input_panel(
                'New name for {0}: '.format(display_name),
                info['displayName'],  # initial text
                on_done,
                None,                 # on_change
                None                  # on_cancel
            )


class TypescriptFinishRenameCommand(TypeScriptBaseTextCommand):
    """
    Called from on_done handler in finish_rename command
    on_done is called by input panel for new name
    """
    def run(self, text, args_json=""):
        args = json_helpers.decode(args_json)
        new_name = args["newName"]
        outer_locations = args["outerLocs"]
        if len(outer_locations) > 0:
            for outerLoc in outer_locations:
                file = outerLoc["file"]
                inner_locations = outerLoc["locs"]
                rename_view = active_window().find_open_file(file)
                if not rename_view:
                    # File not loaded but on disk
                    client_info = cli.get_or_add_file(file)
                    client_info.rename_on_load = {"locs": inner_locations, "name": new_name}
                    active_window().open_file(file)
                elif rename_view != self.view:
                    # File opened but not current one
                    rename_view.run_command('typescript_delayed_rename_file',
                                           {"locs_name": {"locs": inner_locations, "name": new_name}})
                else:
                    for inner_location in inner_locations:
                        start_line, start_offset = extract_line_offset(inner_location["start"])
                        end_line, end_offset = extract_line_offset(inner_location["end"])
                        apply_edit(text, self.view, start_line, start_offset, end_line,
                                   end_offset, new_text=new_name)


class TypescriptDelayedRenameFile(TypeScriptBaseTextCommand):
    """Rename in 'on_load' method"""
    def run(self, text, locs_name=None):
        if locs_name['locs'] and (len(locs_name['name']) > 0):
            locs = locs_name['locs']
            name = locs_name['name']
            for inner_location in locs:
                start_line, start_offset = extract_line_offset(inner_location['start'])
                end_line, end_offset = extract_line_offset(inner_location['end'])
                apply_edit(text, self.view, start_line, start_offset, end_line,
                           end_offset, new_text=name)
