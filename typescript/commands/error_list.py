from ..libs import global_vars
from .base_command import TypeScriptBaseWindowCommand

class TypescriptProjectErrorList(TypeScriptBaseWindowCommand):

    error_list_panel = None

    def run(self):
        if not TypescriptProjectErrorList.error_list_panel:
            TypescriptProjectErrorList.error_list_panel = self.window.create_output_panel("errorList")

        if not cli.node_client.workerStarted():
            view = active_view()
            # start worker process
            cli.node_client.startWorker()       
            # load the active project
            get_info(view)
            # send the first error request
            cli.service.request_get_err_for_project(0, view.file_name())

        global_vars._is_worker_active = True
        self.window.run_command("show_panel", {"panel": "output.errorList"})

    @staticmethod
    def is_worker_active():
        panel = TypescriptProjectErrorList.error_list_panel  
        return panel is not None and is_view_visible(panel)