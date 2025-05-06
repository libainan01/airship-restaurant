class_name MainShipController
extends Area2D

var left_hoding_trigger_time = 0.5
var left_time = 0

#Key
var is_mouse_enter = false

func _ready() -> void:
	input_pickable = true;

func _on_input_event(viewport: Node, event: InputEvent, shape_idx: int) -> void:
	if event is InputEventMouseButton:#监听鼠标点击事件
		if event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
			_mouse_left_click()
		if event.button_index == MOUSE_BUTTON_LEFT and !event.pressed:
			_mouse_left_release()

func _process(delta: float) -> void:
	if !is_mouse_enter : return #如果鼠标没有进入区域，则不响应点击事件

	if Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		left_time += delta
		if left_hoding_trigger_time <= left_hoding_trigger_time:
			_mouse_left_hoding()

func _mouse_left_click() -> void:
	pass
func _mouse_left_release() ->void:
	left_time = 0
	get_node("/root/MainScene/CableBase/Line2D")._draw_path2D()#跟新缆绳的位置
func _mouse_left_hoding()->void:
	var mouse_position = get_global_mouse_position()
	var Airship = get_parent()
	Airship.global_position = Vector2(mouse_position.x,Airship.global_position.y)
	get_node("/root/MainScene/CableBase/Line2D")._draw_line()#跟新缆绳的位置
	get_node("/root/MainScene/Truck/Pulley").update_position()#更新运输车的位置

func _on_mouse_entered() -> void:
	is_mouse_enter = true

func _on_mouse_exited() -> void:
	is_mouse_enter = false
