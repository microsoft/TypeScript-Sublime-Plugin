import sublime
import sublime_plugin

from ..libs import cli, log, global_vars
from ..libs.view_helpers import active_view, get_info, is_typescript, active_view
from ..libs.panel_manager import get_panel_manager
from ..listeners.project_error_list import start_timer
from .base_command import TypeScriptBaseWindowCommand

class TypescriptProjectErrorList(sublime_plugin.WindowCommand):

    def is_enabled(self):
        return is_typescript(active_view()) and not global_vars.IS_ST2

    def run(self):
        panel_manager = get_panel_manager()
        panel_manager.add_panel("errorlist")
        
        if not cli.node_client.workerStarted():
            panel_manager.show_panel("errorlist", ["Starting worker for project error list..."])
            # start worker process
            cli.node_client.startWorker() 
        else:
            # The server is up already, so just show the panel without overwriting the content
            panel_manager.show_panel("errorlist")

        opened_views = [view for view in self.window.views() if view.file_name() is not None]
        for opened_view in opened_views:          
            # load each opened file
            get_info(opened_view)

        # send the first error request
        # cli.service.request_get_err_for_project(0, view.file_name())
        start_timer()


class TypescriptGotoError(sublime_plugin.TextCommand):

    def is_enabled(self):
        return is_typescript(active_view()) and not global_vars.IS_ST2

    def run(self, text):
        pass