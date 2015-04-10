import sublime
import threading
import time
from logger import log


class PopupManager():
    """ Manages the popup session information for the editor

    The environment is multi-threaded, and the response processing happens
    on a different thread to the UI events and sending of requests

    This class makes the assumption only one popup will be active at a time,
    with the latest set of signature data received, that only one request 
    may be awaiting a response at a time, and that only one request may be 
    waiting to send at a time.

    There is a concept of 2 requests: queued and current.

    A queued request has not been run yet, so can be updated or cleared at 
    any time.  Once it becomes 'due', either it becomes the current request and
    executed, or if there is still a current, it gets requeued.

    A current request has been sent, but may not have received a response yet.
    If cleared before a response is received, the callback will be ignored.

    If on_close_popup is called, or a request is received for a different view
    the prior request, then all outstanding requests are cleared.
    """
    def __init__(self):
        # Used to avoid race conditions across threads
        self.lock = threading.RLock()
        self.current_view = None

        # Maintains the latest set of signature data and rendering info
        self.signature_help = None
        self.popup_template = None

        # Maintains the index of the current signature selected
        self.signature_index = 0
        self.current_parameter = 0

        # Is set to the True to do the callback when a response is received.
        # Will be False to indicate a running request is to be ignored.
        self.active_request_callback = False

        # Hold the next request to make when scheduled.
        # Set to None to cancel, or reassign before it starts
        self.queued_request_fn = None

        # Used to track latency for deciding when to schedule the next request
        self.last_execution_time = 0
        self.last_execution_cost = 0

    def queue_request(self, view, request):
        # with self.lock:
            if self.current_view != view:
                self.on_close_popup()
                self.current_view = view

            # How long to defer execution.  Minimum 40ms
            delta_ms = 40
            if self.last_execution_time:
                min_delay = self.last_execution_cost * 4
                next_time = self.last_execution_time + min_delay
                delta_ms = int((next_time - time.time()) * 1000)

            # Ensure no less that 40ms, and no more than 400ms
            delta_ms = max(40, delta_ms)
            delta_ms = min(400, delta_ms)

            if not self.queued_request_fn:
                sublime.set_timeout(self.on_scheduled, delta_ms)
            self.queued_request_fn = lambda: request(self.on_response)

    def on_scheduled(self):
        # with self.lock:
            # Do we still have a request to worry about
            if self.queued_request_fn:
                # If an active request is still running, try again in 100ms
                if self.active_request_callback:
                    sublime.set_timeout(self.on_scheduled, 100)
                else:
                    self.active_request_callback = True
                    self.last_execution_time = time.time()
                    self.queued_request_fn()
                    self.queued_request_fn = None

    def on_response(self, response):
        # with self.lock:
            self.last_execution_cost = time.time() - self.last_execution_time
            if not self.active_request_callback:
                return
            else:
                self.active_request_callback = False

            if not response.success or not response.body:
                log.debug('No results for signature request')
                self.on_close_popup()
            else:
                log.debug('Setting signature help data')
                self.signature_help = response.body
                self.signature_index = response.body.selectedItemIndex
                self.current_parameter = response.body.argumentIndex

                # Add a region to track the arg list as the user types
                # Needs to be ajusted to 0-based indexing
                arg_span = self.signature_help.applicableSpan
                span_start = self.current_view.text_point(
                                            arg_span.start.line - 1,
                                            arg_span.start.offset - 2)
                span_end = self.current_view.text_point(
                                            arg_span.end.line - 1,
                                            arg_span.end.offset - 0)
                arg_region = sublime.Region(span_start, span_end)
                self.current_view.add_regions('argSpan', [arg_region],
                            #scope='comments', flags=sublime.DRAW_EMPTY)
                            flags=sublime.HIDDEN)

                self.display()

    def display(self):
        popup_parts = self.get_current_signature_template()
        popup_text = self.popup_template.substitute(popup_parts)

        log.debug('Displaying signature popup')
        if not self.current_view.is_popup_visible():
            self.current_view.show_popup(
                popup_text,
                sublime.COOPERATE_WITH_AUTO_COMPLETE,
                on_navigate=self.on_navigate,
                on_hide=self.on_hidden,
                max_width=800)
        else:
            self.current_view.update_popup(popup_text)

    def signature_to_html(self, item):
        result = ""

        def html_escape(str):
            return str.replace('&','&amp;').replace(
                                '<','&lt;').replace('>',"&gt;")

        def normalize_style(name):
            if name in ['methodName']:
                return 'name'
            elif name in ['keyword', 'interfaceName']:
                return 'type'
            elif name in ['parameterName']:
                return 'param'
            return 'text'

        def concat_display_parts(parts, underline_name=False):
            result = ""
            template = '<span class="{0}">{1}</span>'
            for part in parts:
                css_class = normalize_style(part.kind)
                result += template.format(css_class, html_escape(part.text))
                if underline_name and css_class == 'param':
                    result = '<span class="current">' + result + '</span>'
            return result

        # Add the prefix parts
        result += concat_display_parts(item.prefixDisplayParts)

        # Add the params (if any)
        if item.parameters:
            idx = 0
            for param in item.parameters:
                if idx:
                    result += ", "
                result += concat_display_parts(param.displayParts,
                                               idx == self.current_parameter)
                idx += 1

        # Add the suffix parts
        result += concat_display_parts(item.suffixDisplayParts)

        return result

    def get_current_signature_template(self):
        if self.signature_index == -1:
            return ""
        if self.signature_index >= len(self.signature_help.items):
            self.signature_index = len(self.signature_help.items) - 1

        item = self.signature_help.items[self.signature_index]
        signature = self.signature_to_html(item)
        if item.documentation:
            description = item.documentation[0].text
        else:
            description = ""

        if self.current_parameter >= 0 and item.parameters:
            if self.current_parameter >= len(item.parameters):
                self.current_parameter = len(item.parameters) - 1
            param = item.parameters[self.current_parameter]
            activeParam = '<span class="param">{0}:</span> <i>{1}</i>'.format(
                    param.name,
                    param.documentation[0].text if param.documentation else "")
        else:
            activeParam = ''

        return {"signature": signature,
                "description": description,
                "activeParam": activeParam,
                "index": "{0}/{1}".format(self.signature_index + 1,
                                          len(self.signature_help.items)),
                "link": "link"}

    def move_next(self):
        if not self.signature_help:
            return
        self.signature_index += 1
        if self.signature_index >= len(self.signature_help.items):
            self.signature_index = len(self.signature_help.items) - 1
        self.display()

    def move_prev(self):
        if not self.signature_help:
            return
        self.signature_index -= 1
        if self.signature_index < 0:
            self.signature_index = 0
        self.display()

    def on_navigate(self, loc):
        # Clicked the overloads link.  Dismiss this popup and show the panel
        self.on_close_popup()
        self.current_view.run_command('typescript_signature_panel')

    def on_hidden(self):
        log.debug('In popup on_hidden handler')
        if not self.current_view:
            return

        cursor_region = self.current_view.sel()[0]
        arg_regions = self.current_view.get_regions('argSpan')
        if len(arg_regions):
            argSpan = self.current_view.get_regions('argSpan')[0]
            if argSpan.contains(cursor_region):
                log.debug('Was hidden while in region.  Redisplaying')
                # Occurs on left/right movement.  Rerun to redisplay popup.
                self.display()
        else:
            # Cleanup
            self.on_close_popup()

    def on_close_popup(self):
        """ Call whenever the view loses focus, of the region is exited """
        if self.current_view:
            self.current_view.erase_regions('argSpan')
            self.current_view.hide_popup()
            self.current_view = None
        self.signature_help = None
        self.last_execution_time = 0
        self.last_execution_cost = 0
        self.active_request_callback = None
        self.queued_request_fn = None

    def is_active(self):
        return True if self.current_view else False

# Overwrite the identifier with a singleton instance
PopupManager = PopupManager()
