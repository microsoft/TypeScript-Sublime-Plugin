from ..libs import cli
from ..libs.view_helpers import active_view, get_info
from ..libs.panel_manager import get_panel_manager
from ..listeners.project_error_list import start_timer
from .base_command import TypeScriptBaseWindowCommand

class TypescriptProjectErrorList(TypeScriptBaseWindowCommand):

    def run(self):
        panel_manager = get_panel_manager()
        panel_manager.add_panel("errorlist")
        panel_manager.show_panel("errorlist")

        if not cli.node_client.workerStarted():
            view = active_view()
            # start worker process
            cli.node_client.startWorker()       
            # load the active project
            get_info(view)
            # send the first error request
            # cli.service.request_get_err_for_project(0, view.file_name())
            start_timer()