class_name Cable_car
extends Node2D

var _path_follow:PathFollow2D
var _docing_device:Docking_device

func _init(new_path_follow:PathFollow2D,new_docking_device:Docking_device) -> void:
	_path_follow = new_path_follow
	_docing_device = new_docking_device

func _ready() -> void:
	pass
	

#region cable_car属性
var _MoveSpeed = 100
var _target_position:Vector2
var _canmove :bool = false
var _move_path :PathFollow2D
#endregion

#region 移动相关
var _trunk:Trunk
#endregion

func _process(delta: float) -> void:
	if _canmove :
		_cable_car_move(delta)
	pass

func _cable_car_move(delta:float)->void:
	
	pass

func _call_the_trunk(caller:Node2D)->void:
	_target_position = caller.global_position
	_canmove = true
	

func _on_trunk_capacity_changes(trunk_state: Trunk.TRUNK_STATE, current_capacity: int) -> void:
	
	pass # Replace with function body.
	
func _set_path_follow (new_path_follow:PathFollow2D) -> void:
	_move_path = new_path_follow
	
