extends Node

var special_shaped_window:SpecialShapedWindow
var _airship_screen_size:Vector2i

#region 窗口尺寸更改信号
signal message_bottom_height_change(height_offset:float)

func _init() -> void:
	special_shaped_window = SpecialShapedWindow.new()
	add_child(special_shaped_window)

func _ready() -> void:
	get_tree().create_timer(3.0).timeout.connect(_test_change_size)
	_airship_screen_size = get_window().size

func _test_change_size()->void:
	set_main_window_bottom_height_offset(100)
	
func set_main_window_bottom_height_offset(height_offset:float)->void:
	message_bottom_height_change.emit(height_offset)
	_airship_screen_size.y = _airship_screen_size.y + height_offset
