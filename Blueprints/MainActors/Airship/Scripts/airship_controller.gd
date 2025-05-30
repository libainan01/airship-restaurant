class_name MainShipController
extends Area2D

var left_hoding_trigger_time = 0.5
var left_time = 0
#Key
var is_mouse_enter = false
var isAirshipMoved = true
var is_dragging = false

#glob_porprty
var mouse_click_space:MouseClickSpace
var main_scene:MainScene

func _ready() -> void:
	input_pickable = true;
	main_scene = get_tree().root.get_child(0)
	mouse_click_space = main_scene._get_mouse_click_space()
	_add_new_collison_space()

func _input(event: InputEvent) -> void:
	if !is_mouse_enter:return #若鼠标不在点击范围内，则不响应鼠标的左键点击事件
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_LEFT:
			if event.pressed:
				_mouse_left_hold()
		

func _on_input_event(viewport: Node, event: InputEvent, shape_idx: int) -> void:
	if event is InputEventMouseButton:#监听鼠标点击事件
		if event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
			_mouse_left_click()
		if event.button_index == MOUSE_BUTTON_LEFT and !event.pressed:
			_mouse_left_release()

# -------------Mouse Button Event------------------#
func _mouse_left_click() -> void:
	mouse_click_space._remove_mouse_click_space(self,true)
	pass
func _mouse_left_release() ->void:
	_add_new_collison_space()
	left_time = 0
func _mouse_left_hold() ->void:
	_move_airship(get_global_mouse_position())
# -------------Mouse Button Event------------------#
	
func _move_airship(_position:Vector2) ->void:
	var Airship = get_parent()
	Airship.global_position = _position
	isAirshipMoved = true

func add_debug_point (position: Vector2 ,color: Color = Color.RED,size: float = 5.0) ->void:
	var line = Line2D.new()
	line.add_point(Vector2(0,0))
	line.default_color = color
	line.width = size
	add_child(line)
	line.global_position = position

func _on_mouse_entered() -> void:
	is_mouse_enter = true

func _on_mouse_exited() -> void:
	is_mouse_enter = false
	
#----------------Mouse Collison Space--------------------#
func _add_new_collison_space () ->void:
	var CollisionShape = get_child(0) as CollisionShape2D
	var CenterPoint = CollisionShape.global_position
	var RectangleShape = CollisionShape.shape as RectangleShape2D
	var LeftBottomPoint = Vector2i(CenterPoint.x - (RectangleShape.size.x/2),CenterPoint.y + (RectangleShape.size.y/2)) as Vector2i
	var RightBottomPoint = Vector2i(CenterPoint.x + (RectangleShape.size.x/2),CenterPoint.y + (RectangleShape.size.y/2)) as Vector2i
	var newpoints =  [LeftBottomPoint,RightBottomPoint] as PackedVector2Array
#	mouse_click_space._add_mouse_click_space(self,newpoints)
