class_name Pulley
extends Node2D
var MoveSpeed = 100
var path_follow: PathFollow2D
var path2D:Path2D

var _trunk_base : trunk_base

var StartPoint : Vector2
var EndPoint : Vector2

func _ready() -> void:
	_trunk_base = get_parent() as Node2D
	update_position()
	position = StartPoint
	
	
	path_follow = get_node("/root/MainScene/CableBase/Line2D/Path2D/PathFollow2D") as PathFollow2D
	path2D = get_node("/root/MainScene/CableBase/Line2D/Path2D") as Path2D

func _process(delta: float) -> void:
#	pulley_move(_trunk_base.current_trunk_state,delta)#获取到Trunk_base中的State，来切换移动状态
	pass

func pulley_move(move_state:int,delta:float)->void:
	if move_state == 2 or move_state == 3: return # 如果当前状态是Wait，则直接返回
	if move_state == 0:
		path_follow.progress += MoveSpeed * delta
		var path_length = path2D.curve.get_baked_length()
		if path_follow.progress >= path_length-5:
			position = EndPoint
			_trunk_base.change_trunk_state(trunk_base.TRUNK_STATE.WAITATEND)#当到达终点，停止运动
			return
		position = path_follow.global_position
	if move_state == 1:
		path_follow.progress -= MoveSpeed*delta
		if path_follow.progress <= 5:
			position = StartPoint
			_trunk_base.change_trunk_state(trunk_base.TRUNK_STATE.WAITATSTART)#当到达终点，停止运动
			return
		position = path_follow.global_position

func update_position () ->void:
	if _trunk_base.current_trunk_state == 2 :
		position = StartPoint
