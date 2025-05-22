class_name MainShipController
extends Area2D

var mouse_click_space_path = preload("res://Blueprints/Components/mouse_click_space.tscn")
var mouse_click_space : MouseClickSpace

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
	_remove_mouse_space()
	pass
func _mouse_left_release() ->void:
	_creat_mouse_space(Vector2(0,0))
	left_time = 0
func _mouse_left_hoding()->void:
	#移动船体
	var mouse_position = get_global_mouse_position()
	_move_airship(mouse_position)
	
func _move_airship(_position:Vector2) ->void:
	var Airship = get_parent()
	Airship.global_position = _position

#移除 鼠标点击范围
func _remove_mouse_space()-> void:
	#移除鼠标点击范围限制
	var _owner = owner as Airship_Scene
	_owner.get_mainwindow().mouse_passthrough_polygon = []
	if mouse_click_space != null :
		mouse_click_space.queue_free()
		mouse_click_space = null
	

#添加 鼠标点击范围
func _creat_mouse_space (new_position:Vector2) -> void:
	var polygon_point = PackedVector2Array([Vector2(0,0),Vector2(500,0),Vector2(500,500),Vector2(0,500)])
	var _owner = owner as Airship_Scene
	if mouse_click_space != null:
		push_error("mouse_click_space Failed to delete normally")
		return
	
	mouse_click_space = mouse_click_space_path.instantiate() as MouseClickSpace
	mouse_click_space._create_polygon_by_point(polygon_point)
	#添加鼠标点击范围限制
	var polygon_point_with_offset : PackedVector2Array
	for point in polygon_point :
		polygon_point_with_offset.append(point+new_position)#添加偏移
	_owner.get_mainwindow().mouse_passthrough_polygon = mouse_click_space.polygon


func _on_mouse_entered() -> void:
	is_mouse_enter = true

func _on_mouse_exited() -> void:
	is_mouse_enter = false
