class_name Docking_device extends Node2D

#region 连机器属性
var _link_position : Vector2
var _can_docking : bool = true
var _linking_docking_device : Docking_device
@export var _owner_storage:Storage
#endregion

#region 连接器信号
signal message_docking_complete(link_docking_device:Docking_device)  #对接完成信号
signal message_docking_start(link_docking_device:Docking_device)     #开始对接信号
signal message_separate_start(separate_docking_device:Docking_device)    #开始分离信号
signal message_separate_complete(separate_docking_device:Docking_device) #分离完成信号
#endregion

func _ready() -> void:
	var _building = get_parent() as AirshipBuilding
	_link_position = _get_link_position(_building._mount_direction)
	pass
#region Docking_device接口
func get_link_position()->Vector2 :
	return _link_position

func start_the_docking_process (_link_target:Docking_device)->void:
	_can_docking = false
	_linking_docking_device = _link_target
	#触发自己和link_target的对接信号
	self.message_docking_start.emit(_link_target)
	_link_target.message_docking_start.emit(self)
	
	#TODO：1、播放对接动画 2、监听动画播放完成
	_end_the_docing_prcess(_link_target)

func start_the_separate_process()->void:
	#触发自己和link_target的对接信号
	self.message_separate_start.emit(_linking_docking_device)
	_linking_docking_device.message_separate_start.emit(self)
	
	#TODO:1、播放分离动画2、监听分离动画完成
	
#endregion
func _get_link_position(_link_direction:AirshipBuilding.mount_direction) -> Vector2:
	var _vec:Vector2
	match _link_direction:
		AirshipBuilding.mount_direction.Top:
			_vec = Vector2(global_position.x,0)
		AirshipBuilding.mount_direction.Bootom:
			_vec = Vector2(global_position.x,0)
		AirshipBuilding.mount_direction.Left:
			_vec = Vector2(0,global_position.y)
		AirshipBuilding.mount_direction.Dynamic:
			_vec = Vector2(0,0)
	return _vec

func _end_the_docing_prcess (_link_target:Docking_device)-> void :
	#触发自己和link_target的对接信号
	self.message_docking_complete.emit(_link_target)
	_link_target.message_docking_complete.emit(self)

func _end_the_separate_process()->void:
	_can_docking = true
	#触发自己和link_target的分离信号
	self.message_separate_complete.emit(_linking_docking_device)
	_linking_docking_device.message_docking_complete.emit(self)
	_linking_docking_device = null #分离完成，清除数据
