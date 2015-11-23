import sublime
import sublime_plugin

from ..libs import cli, log, global_vars
from ..libs.view_helpers import active_view, get_info, is_typescript, active_view
from ..libs.panel_manager import get_panel_manager
from ..listeners.error_list import start_timer
from .base_command import TypeScriptBaseWindowCommand

class TypescriptProjectErrorList(sublime_plugin.WindowCommand):

    def is_enabled(self):
        return is_typescript(active_view()) and not global_vars.IS_ST2 and global_vars.get_language_service_enabled()

    def run(self):
        panel_manager = get_panel_manager()
        panel_manager.add_panel("errorlist")
        
        if not cli.worker_client.started():
            panel_manager.show_panel("errorlist", ["Starting worker for project error list..."])
            # start worker process
            cli.worker_client.start()
        else:
            # The server is up already, so just show the panel without overwriting the content
            panel_manager.show_panel("errorlist")

        opened_views = [view for view in self.window.views() if view.file_name() is not None]
        for opened_view in opened_views:          
            # load each opened file
            get_info(opened_view)

        # send the first error request
        start_timer()


class TypescriptGoToError(sublime_plugin.TextCommand):

    def is_enabled(self):
        return not global_vars.IS_ST2 and global_vars.get_language_service_enabled()

    def run(self, text):
        print("TypeScriptGoToError")
        error_line, _ = self.view.rowcol(self.view.sel()[0].begin())
        self.update_error_line(error_line)
        line_map = get_panel_manager().get_line_map("errorlist")
        if error_line in line_map:
            file_name, row, col = line_map[error_line]
            sublime.active_window().open_file(
                '{0}:{1}:{2}'.format(file_name, row or 0, col or 0),
                sublime.ENCODED_POSITION
            )

    def update_error_line(self, line):
        self.view.erase_regions("cur_error")
        caret_pos = self.view.text_point(line, 0)
        # sublime 2 doesn't support custom icons
        icon = "Packages/" + global_vars.PLUGIN_NAME + "/icons/arrow-right3.png"
        self.view.add_regions(
            "cur_error",
            [sublime.Region(caret_pos, caret_pos + 1)],
            "keyword",
            icon,
            sublime.HIDDEN
        )