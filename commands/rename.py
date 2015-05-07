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
        renameResp = cli.service.rename(self.view.file_name(), get_location_from_view(self.view))
        if renameResp["success"]:
            infoLocs = renameResp["body"]
            displayName = infoLocs["info"]["fullDisplayName"]
            outerLocs = infoLocs["locs"]

            def on_cancel():
                return

            def on_done(newName):
                args = {"newName": newName, "outerLocs": outerLocs}
                args_json_str = jsonhelpers.encode(args)
                self.view.run_command('typescript_finish_rename', {"argsJson": args_json_str})

            if len(outerLocs) > 0:
                sublime.active_window().show_input_panel(
                    "New name for {0}: ".format(displayName),
                    infoLocs["info"]["displayName"],
                    on_done, None, on_cancel
                )


class TypescriptFinishRenameCommand(sublime_plugin.TextCommand):
    """
    Called from on_done handler in finish_rename command
    on_done is called by input panel for new name
    """
    def run(self, text, argsJson=""):
        args = jsonhelpers.decode(argsJson)
        newName = args["newName"]
        outerLocs = args["outerLocs"]
        if len(outerLocs) > 0:
            for outerLoc in outerLocs:
                file = outerLoc["file"]
                innerLocs = outerLoc["locs"]
                activeWindow = sublime.active_window()
                renameView = activeWindow.find_open_file(file)
                if not renameView:
                    clientInfo = cli.get_or_add_file(file)
                    clientInfo.rename_on_load = {"locs": innerLocs, "name": newName}
                    activeWindow.open_file(file)
                elif renameView != self.view:
                    renameView.run_command('typescript_delayed_rename_file',
                                           {"locsName": {"locs": innerLocs, "name": newName}})
                else:
                    for innerLoc in innerLocs:
                        startlc = innerLoc["start"]
                        (startl, startc) = extract_line_offset(startlc)
                        endlc = innerLoc["end"]
                        (endl, endc) = extract_line_offset(endlc)
                        apply_edit(text, self.view, startl, startc, endl,
                                   endc, ntext=newName)


class TypescriptDelayedRenameFile(sublime_plugin.TextCommand):
    def run(self, text, locsName=None):
        if locsName['locs'] and (len(locsName['name']) > 0):
            locs = locsName['locs']
            name = locsName['name']
            for innerLoc in locs:
                startlc = innerLoc['start']
                (startl, startc) = extract_line_offset(startlc)
                endlc = innerLoc['end']
                (endl, endc) = extract_line_offset(endlc)
                apply_edit(text, self.view, startl, startc, endl,
                           endc, ntext=name)
