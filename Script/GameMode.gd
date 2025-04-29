extends Node
var window_controller

func _ready() -> void:
	await RenderingServer.frame_post_draw  #等待窗口绘制完成
	var viewport = get_viewport()
	#设置全屏和窗口透明
	set_window_mode(Window.MODE_FULLSCREEN)
	viewport.transparent_bg = true 
	#设置鼠标穿透
	var hwnd = DisplayServer.window_get_native_handle(DisplayServer.WINDOW_HANDLE)
	window_controller = WindowController.new()
	window_controller.SetWindowMousePassthrough(hwnd,true)
	#获取窗口贴图
	var texture = viewport.get_texture()
	var image = texture.get_image()
	if !image.is_empty() :
		image.convert(image.FORMAT_RGBA8)
		for y in image.get_height():
			for x in image.get_width():
				var color = image.get_pixel(x,y)
				color.a = 255
				image.set_pixel(x,y,color)
		#window_controller.UpdateBitmap(image.get_width(),image.get_height(),image.get_data())

func set_window_mode(mode:Window.Mode):
	get_viewport().get_window().mode = mode
