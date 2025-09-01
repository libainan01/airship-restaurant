extends AirshipItemDataBase
class_name Task
#region 任务属性
var task_priority: int
var docking_device:Docking_device
#endregion
func _init(new_task_priority:int,new_docking_device:Docking_device) -> void:
	task_priority = new_task_priority
	docking_device = new_docking_device
