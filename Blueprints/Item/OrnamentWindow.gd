extends Window
#加载C++类
var window_controller = preload("res://addons/mouse_passthrough/bin/windows_linker.gdextension")

func _ready() -> void:
	
	var windowhandle = DisplayServer.window_get_native_handle(DisplayServer.WINDOW_HANDLE,1)
	var windows_controller = WindowController.new()
	#windows_controller.SetWindowMousePassthrough(windowhandle,true)
	#windows_controller.UpdateBitmap(0,0,PackedByteArray())
	
