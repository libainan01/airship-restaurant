extends AirshipBuilding
class_name Cable_car

#region cable_car属性
var _MoveSpeed = 100
var _task_position:Vector2
var _current_task:Task
var _canmove :bool = false
var _move_path :PathFollow2D
var _task_progress :float
var _total_task_progress :float
var _docking_device:Docking_device
#endregion

#region 移动相关
var _trunk:Trunk
#endregion

func _init_cable_car(new_path_follow:PathFollow2D) -> void:
	_move_path = new_path_follow
	_mount_direction = mount_direction.Dynamic


func _ready() -> void:
	_docking_device = get_child(1)

func _process(delta: float) -> void:
	if _canmove :
		_cable_car_move(delta)
	pass

func _cable_car_move(delta:float)->void:
	_move_path.progress = _move_path.progress + _MoveSpeed * delta
	_calculate_task_progress()
	if _task_progress >=1 :
		_canmove = false
	pass

func _on_trunk_capacity_changes(trunk_state: Trunk.TRUNK_STATE, current_capacity: int) -> void:
	
	pass # Replace with function body.
	
func _set_path_follow (new_path_follow:PathFollow2D) -> void:
	_move_path = new_path_follow
	
func _calculate_task_progress()->void:
	var _vec2d = global_position - _task_position
	_task_progress = _vec2d.length() / _total_task_progress
	
func _mission_complete()->void:
	_docking_device.start_the_docking_process(_current_task.docking_device)
	pass
#region cable_car对外接口
func send_task(task:Task)->void:
	#初始化任务点和任务对象
	_task_position = task.docking_device.get_link_position()
	#初始化任务进度
	var _vec2D : Vector2 = _task_position - global_position
	_total_task_progress = _vec2D.length()
	_current_task = task
	_canmove = true

func get_docking_device() -> Docking_device:
	var _docking_device = get_child(1) as Docking_device
	return _docking_device
#endregion
