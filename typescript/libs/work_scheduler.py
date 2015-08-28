import sublime
import threading
import time

from .logger import log


class WorkScheduler():

    """ Manages the scheduling of high frequency work-items

    The editor is expected to be fast and responsive. Frequently performing
    slow or blocking work on the UI thread is undesirable.  This is a challenge
    for a feature such as signature help, where the requested data can be high
    cost to retrieve, and the data needs to be retrieved frequently as the user
    edits within the call. This class is largely designed to aid this scenario.

    The work scheduler adds value by throttling high volumes of requests to
    avoid over-updating, and by managing the transfer of work across threads.

    This class makes the assumption only one popup will be active at a time,
    with the latest set of signature data received.  It provides a design where
    only one request may be sent but awaiting a response at a time, and that
    only one request may be waiting to send at a time - these are refered to as
    the 'current', and 'queued' requests below.

    A current request has been sent, but may not have received a response yet.
    If the popup is canceled before a response is received, the callback will
    be ignored.

    A queued request has not been started yet, so can be updated or canceled at
    any time.  Once it becomes 'due', either it becomes the current request and
    executed, or if there is still a current running, it gets requeued.

    To avoid race conditions, the following design & usage requirements should
    generally be adhered to:
     - All queued requests are scheduled with sublime.set_timeout, which
       schedules work for the UI thread, and requests are sent on this thread.
       Once it begins, it may chose to run the work on another thread however.
     - The final 'done' callback can happen on any thread, but will also use
       set_timeout to move the completion work and UI updating to the UI thread

    This design has the following benefits:
     - Most tracking state is only touched by the UI thread, thus reducing the
       need for complex locks or queues to avoid race conditions.
     - Most actual Python processing happens on the one thread (assuming work
       offloaded is mostly I/O bound work).  Due to the GIL, this is usually
       the most efficient exeuction model for non-blocked work.


    ## Example use of queue_request

        # Set some locals to capture in the worker functions provided
        _view = self.view
        _file = self.filename
        _loc  = self.view.location

        # Define a function to do the request and notify on completion
        def get_signature_data(on_done):
            cli.request_signature_help(_file, _loc, on_done)

        # Define a function to handle the completion response
        def do_display(signature_data):
            popup_text = get_sig_popup(signature_data)
            _view.show_popup(popup_text)

        # Schedule the request
        queue_request(get_signature_data, do_display)
    """

    def __init__(self):
        self.lock = threading.Lock()

        # Set to the callback to be executed on the next schedule execution
        self.next_job = None
        # Set to the time the last job started execution
        self.last_time = 0
        # Set to the amount of time the last job took to execute
        self.last_cost = 0
        # Set to True if a timer is already pending
        self.timer_set = False
        # Set to True if a job is currently executing
        self.job_running = False
        # Set to True if the outstanding work has been canceled
        self.canceled = False

    def queue_request(self, worker, handler):
        log.debug('In queue_request for work scheduler')

        # Use nested functions to close over the worker and handler parameters

        def work_done(results):
            """ Called when the scheduled work item is complete

            This function does some bookkeeping before calling the completion
            handler provided when the job was queued.
            """
            log.debug('In work_done for work scheduler')
            end_time = time.time()
            canceled = False
            with self.lock:
                self.last_cost = end_time - self.last_time
                self.job_running = False
                canceled = self.canceled
            log.debug('Work took {0:d}ms'.format(int(self.last_cost * 1000)))
            if not canceled:
                # Post the response to the handler on the main thread
                sublime.set_timeout(lambda: handler(results), 0)

        def do_work():
            """ Called to execute the worker callback provided

            This function closes over the worker callback provided, and is
            stored in the slot for the queued work item (self.next_job).
            """
            log.debug('In do_work for work scheduler')
            start_time = time.time()
            canceled = False
            with self.lock:
                self.last_time = start_time
                canceled = self.canceled
                if canceled:
                    self.job_running = False
            if not canceled:
                worker(work_done)

        def on_scheduled():
            """ This function is called by the scheduler when the timeout fires

            This pulls the queued work-item from self.next_job, which is an
            instance of 'do_work' above, and executes it.
            """
            log.debug('In on_scheduled for work scheduler')
            job = None
            job_running = False
            with self.lock:
                if self.job_running:
                    job_running = True
                else:
                    # Get the job to run if not canceled, and reset timer state
                    if not self.canceled:
                        job = self.next_job
                    if job:
                        # There will be a job running when this function exits
                        self.job_running = True
                    self.timer_set = False
                    self.next_job = None
            if job_running:
                # Defer 50ms until current job completes.
                log.debug('Timer elapsed while prior job running.  Deferring')
                sublime.set_timeout(on_scheduled, 50)
            else:
                if job:
                    job()

        # When to set the timer for next.
        delta_ms = 0
        job_scheduled = False
        curr_time = time.time()

        with self.lock:
            # Ensure queued job is this job and state is not canceled
            self.next_job = do_work
            self.canceled = False
            job_scheduled = self.timer_set
            if not self.timer_set:
                # How long to defer execution. Use last cost as basis
                if self.last_cost:
                    min_delay = self.last_cost * 3
                    next_time = self.last_time + min_delay
                    delta_ms = int((next_time - curr_time) * 1000)
                else:
                    delta_ms = 33
            self.timer_set = True  # Will be before this function returns

        if not job_scheduled:
            # Ensure no less that 33ms, and no more than 500ms
            delta_ms = max(33, delta_ms)
            delta_ms = min(500, delta_ms)
            # Run whatever is the 'next_job' when scheduler is due
            log.debug('Scheduling job for {0}ms'.format(delta_ms))
            sublime.set_timeout(on_scheduled, delta_ms)
        else:
            log.debug('Job already scheduled')

    def cancel(self):
        log.debug('In cancel for work scheduler')
        with self.lock:
            self.canceled = True
            self.next_job = None
            self.last_time = 0
            self.last_cost = 0
            self.timer_set = False


_default_scheduler = WorkScheduler()


def work_scheduler():
    return _default_scheduler
