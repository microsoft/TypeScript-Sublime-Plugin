class Message:
    def __init__(self, seq, type):
        """
        A TypeScript Server message
        ``seq`` Sequence number of the message
        ``type`` One of "request", "response", or "event"
        """
        self.seq = seq
        self.type = type


class Request(Message):
    def __init__(self, command, arguments=None):
        """ 
        Client-initiated request message
        ``command`` The command to execute
        ``arguments`` Object containing arguments for the command
        """
        super().__init__(0, "request")
        self.command = command
        self.arguments = arguments


class Response(Message):
    def __init__(self, request_seq, success, message=None, body=None, **kwarg):
        """
        Response by server to client request message
        ``request_seq`` Sequence number of the request message
        ``success`` Outcome of the request
        ``message`` Contains error message if success == false.
        ``body`` Contains message body if success == true.
        """
        super().__init__(**kwarg)
        self.request_seq = request_seq
        self.success = success
        self.message = message
        self.body = body


class FileRequestArgs:
    def __init__(self, file):
        """
        Arguments for FileRequest messages
        ``file`` The file for the request (absolute pathname required)
        """
        self.file = file


class FileRequest(Request):
    def __init__(self, command, fileRequestArgs):
        """
        Request whose sole parameter is a file name
        """
        super().__init__(command, fileRequestArgs)


class CodeLocationRequestArgs(FileRequestArgs):
    def __init__(self, file, line, col):
        """
        Instances of this interface specify a code location:
        (file, line, col), where line and column are 1-based.
        ``line`` The line number for the request (1-based)
        ``column`` The column for the request (1-based)
        """
        super().__init__(file)
        self.line = line
        self.col = col


class CodeLocationRequest(Request):
    def __init__(self, command, codeLocationRequestArgs):
        """
        A request whose arguments specify a code location (file, line, col)
        """
        super().__init__(command, codeLocationRequestArgs)


class DefinitionRequest(CodeLocationRequest):
    def __init__(self, codeLocationRequestArgs):
        """
        Go to definition request; value of command field is
        "definition". Return response giving the code locations that
        define the symbol found in file at location line, col.
        """
        super().__init__("definition", codeLocationRequestArgs)


class LineCol:
    def __init__(self, line, col):
        """
        Object containing line and column (one-based) of code location
        """
        self.line = line
        self.col = col


class CodeSpan:
    def __init__(self, file, min, lim):
        self.file = file
        self.min = LineCol(**min)
        self.lim = LineCol(**lim)


class CodeSpanWithinFile:
    def __init__(self, min, lim):
        self.min = LineCol(**min)
        self.lim = LineCol(**lim)


class DefinitionResponse(Response):
    def __init__(self, body=None, **kwargs):
        """
        Definition response message.  Gives text range for definition.
        """
        super().__init__(**kwargs)
        self.body = [CodeSpan(**cs) for cs in body] if body else None


class ReferencesRequest(CodeLocationRequest):
    def __init__(self, codeLocationRequestArgs):
        """
        Find references request; value of command field is
        "references". Return response giving the code locations that
        reference the symbol found in file at location line, col.
        """
        super().__init__("references", codeLocationRequestArgs)


class ReferencesResponseItem(CodeSpan):
    def __init__(self, lineText, **kwarg):
        """
        Text of line containing the reference
        """
        super().__init__(**kwargs)
        self.lineText = lineText


class ReferencesResponseBody:
    def __init__(self, refs, symbolName, symbolStartCol, symbolDisplayString):
        self.refs = refs
        self.symbolName = symbolName
        self.symbolStartCol = symbolStartCol
        self.symbolDisplayString = symbolDisplayString


class ReferencesResponse(Response):
    def __init__(self, body=None, **kwargs):
        """
        References response message.  ``body`` is of type ReferencesResponseBody
        """
        super().__init__(**kwargs)
        self.body = ReferencesResponseBody(**body) if body else None


class RenameRequest(CodeLocationRequest):
    def __init__(self, codeLocationRequestArgs):
        """
        Rename request; value of command field is "rename". Return
        response giving the code locations that reference the symbol
        found in file at location line, col. Also return full display
        name of the symbol so that client can print it unambiguously.
        """
        super().__init__("rename", codeLocationRequestArgs)


class RenameInfo:
    def __init__(self, fullDisplayName, **kwarg):
        """
        Information about the item to be renamed.
        ``fullDisplayName`` Full display name of item to be renamed
        """
        self.fullDisplayName = fullDisplayName


class FileLocations:
    def __init__(self, file, locs):
        self.file = file
        self.locs = [CodeSpanWithinFile(**cs) for cs in locs]


class RenameResponseBody:
    def __init__(self, info, locs):
        """
        ``info`` Information about the item to be renamed
        ``locs`` An array of code locations that refer to the item to be renamed.
        """
        self.info = RenameInfo(**info)
        self.locs = [FileLocations(**fl) for fl in locs]


class RenameResponse(Response):
    def __init__(self, body=None, **kwargs):
        """
        Rename response message.
        """
        super().__init__(**kwargs)
        self.body = RenameResponseBody(**body) if body else None


class TypeRequest(CodeLocationRequest):
    def __init__(self, codeLocationRequestArgs):
        """
        Type request; value of command field is "type". Return response
        giving the code locations that define the type of the symbol
        found in file at location line, col.
        """
        super().__init__("type", codeLocationRequestArgs)


class TypeResponse(Response): 
    def __init__(self, body=None, **kwargs):
        super().__init__(**kwargs)
        self.body = [CodeSpan(**cs) for cs in body] if body else None


class OpenRequest(FileRequest):
    def __init__(self, fileRequestArgs):
        """
        Open request; value of command field is "open". Notify the
        server that the client has file open.  The server will not
        monitor the filesystem for changes in this file and will assume
        that the client is updating the server (using the change and/or
        reload messages) when the file changes.
        ``fileRequestArgs`` is of type FileRequestArgs
        """
        super().__init__("open", fileRequestArgs)


class CloseRequest(FileRequest):
    def __init__(self, fileRequestArgs):
        """
        Close request; value of command field is "close". Notify the
        server that the client has closed a previously open file.  If
        file is still referenced by open files, the server will resume
        monitoring the filesystem for changes to file.
        ``fileRequestArgs`` is of type FileRequestArgs
        """
        super().__init__("close", fileRequestArgs)


class QuickInfoRequest(CodeLocationRequest):
    def __init__(self, codeLocationRequestArgs):
        """
        Quickinfo request; value of command field is
        "quickinfo". Return response giving a quick type and
        documentation string for the symbol found in file at location
        line, col.
        """
        super().__init__("quickinfo", codeLocationRequestArgs)


class QuickInfoResponseBody:
    def __init__(self, info, doc):
        """
        Quick info response body details
        ``info`` Type and kind of symbol
        ``doc`` Documentation associated with symbol
        """
        self.info = info
        self.doc = doc


class QuickInfoResponse(Response):
    def __init__(self, body=None, **kwargs):
        """ 
        Quickinfo response message
        """
        super().__init__(**kwargs)
        self.body = QuickInfoResponseBody(**body) if body else None


class CompletionsRequestArgs(CodeLocationRequestArgs):
    def __init__(self, file, line, col, prefix=""):
        """
        Arguments for completions messages
        ``prefix`` Optional prefix to apply to possible completions.
        """
        super().__init__(file, line, col)
        self.prefix = prefix


class CompletionsRequest(CodeLocationRequest):
    def __init__(self, completionsRequestArgs):
        """
        Completions request; value of command field is "completions".
        Given a file location (file, line, col) and a prefix (which may
        be the empty string), return the possible completions that
        begin with prefix.
        """
        super().__init__("completions", completionsRequestArgs)


class SymbolDisplayPart:
    def __init__(self, text, kind):
        """
        Part of a symbol description.
        ``text`` Text of an item describing the symbol
        ``kind`` The symbol's kind (such as 'className' or 'parameterName' or plain 'text')
        """
        self.text = text
        self.kind = kind


class CompletionItem:
    def __init__(self, name, kind, kindModifiers=None, documentation=None):
        """
        An item found in a completion response
        ``name`` The symbol's name
        ``kind`` The symbol's kind (such as 'className' or 'parameterName')
        ``kindModifiers`` Optional modifiers for the kind (such as 'public')
        ``documentation`` Documentation strings for the symbol
        """
        self.name = name
        self.kind = kind
        self.kindModifiers = kindModifiers
        self.documentation = [SymbolDisplayPart(**dp) for dp in documentation] if documentation else None


class CompletionsResponse(Response):
    def __init__(self, body=None, **kwargs):
        super().__init__(**kwargs)
        self.body = [CompletionItem(**ci) for ci in body] if body else None


class ReloadRequestArgs(FileRequestArgs):
    def __init__(self, file, tmpfile):
        """
        Arguments for reload request.
        ``tmpfile`` Name of temporary file from which to reload file contents. May be same as file.
        """
        super().__init__(file)
        self.tmpfile = tmpfile


class ReloadRequest(Request):
    def __init__(self, reloadRequestArgs):
        """
        Reload request message; value of command field is "reload".
        Reload contents of file with name given by the 'file' argument
        from temporary file with name given by the 'tmpfile' argument.
        The two names can be identical.
        """
        super().__init__("reload", reloadRequestArgs)


class ReloadResponse(Response):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)


class ChangeRequestArgs(CodeLocationRequestArgs):
    def __init__(self, file, line, col, deleteLen=0, insertLen=0, insertString=""):
        """
        Arguments for change request message.
        ``deleteLen`` Length of span deleted at location (file, line, col); may be zero.
        ``insertLen`` Length of string to insert at location (file, line, col); may be zero.
        ``insertString`` Optional string to insert at location (file, line col).
        """
        super().__init__(file, line, col)
        self.deleteLen = deleteLen
        self.insertLen = insertLen
        self.insertString = insertString


class ChangeRequest(CodeLocationRequest):
    def __init__(self, changeRequestArgs):
        """
        Change request message; value of command field is "change".
        Update the server's view of the file named by argument 'file'.  
        """
        super().__init__("change", changeRequestArgs)
