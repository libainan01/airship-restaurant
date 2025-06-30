class_name MouseClickSpace
extends Path2D

class PolygonPoint:
	var pp_position:Vector2i
	var type: PointType
	var is_anchor:bool = false #是否是可拖曳的控制点
	var next_point:PolygonPoint
	var last_point:PolygonPoint
	
	func _init(pos:Vector2i,new_type:PointType = PointType.DYNAMIC_POINT):
		pp_position = pos
		type = new_type
		next_point = null
		last_point = null
#region KeyNum

var anchor_head_point: PolygonPoint         #锚点起点
var anchor_tail_point: PolygonPoint         #锚点终点

var head : PolygonPoint                      #动态点起点
var tail : PolygonPoint                      #动态点终点
var size : int = 0

var _path_points = [] #异形窗口边框
var _PolygonPointMap:Dictionary #将点和对象做关联
var _screen_size:Vector2i#当前屏幕分辨率

var top_left_point : PolygonPoint      #左上点
var top_right_point : PolygonPoint     #右上点
var bottom_right_point : PolygonPoint  #右下点
var bottom_left_point : PolygonPoint   #左下点

var _minsize:float #边框宽度
#endregion
enum PointType
{
	TOP_LEFT = 0,
	TOP_RIGHT = 1,
	BOTTOM_RIGHT = 2,
	BOTTOM_LEFT = 3,
	ANCHOR_POINT = 5,
	DYNAMIC_POINT = 8
}


func _ready() -> void:
	_init_mouse_click_space()
	_reload_all_point()
	redraw_mouse_passthrough_polygon()

func _init_mouse_click_space(minsize:float = 2)->void:
	_screen_size = DisplayServer.screen_get_size()#初始化屏幕大小！！！！！！！！！！！！！！！如果动态调整屏幕分辨率后导致异形窗口绘制出错，需要在这里修改
	_minsize = minsize
	
	#初始化anchorPoint
	anchor_head_point = PolygonPoint.new(Vector2i(0,_screen_size.y),PointType.ANCHOR_POINT)                              #左下角
	anchor_head_point.next_point = PolygonPoint.new(_screen_size,PointType.ANCHOR_POINT)                                 #右下角
	
	anchor_head_point.next_point.last_point = anchor_head_point
	anchor_head_point.next_point.next_point = PolygonPoint.new(Vector2i(_screen_size.x,0),PointType.ANCHOR_POINT)        #右上
	
	anchor_head_point.next_point.next_point.last_point = anchor_head_point.next_point
	anchor_tail_point = PolygonPoint.new(Vector2i(0,0),PointType.ANCHOR_POINT)                                           #左上
	
	anchor_head_point.next_point.next_point.next_point = anchor_tail_point
	anchor_tail_point.last_point = anchor_head_point.next_point.next_point
	
	#初始化动态边框
	head = PolygonPoint.new(Vector2i(anchor_tail_point.pp_position.x,anchor_tail_point.pp_position.y+minsize),PointType.TOP_LEFT)     #左上2
	top_left_point = head
	anchor_tail_point.next_point = head
	head.last_point = anchor_tail_point;
	
	head.next_point = PolygonPoint.new(Vector2i(anchor_tail_point.last_point.pp_position.x-minsize,anchor_tail_point.last_point.pp_position.y+minsize),PointType.TOP_RIGHT) #右上2
	top_right_point = head.next_point
	
	head.next_point.last_point = head
	head.next_point.next_point = PolygonPoint.new(Vector2i(anchor_head_point.next_point.pp_position.x-minsize,anchor_head_point.next_point.pp_position.y-minsize),PointType.BOTTOM_RIGHT) #右下2
	bottom_right_point = head.next_point.next_point
	
	head.next_point.next_point.last_point = head.next_point
	tail = PolygonPoint.new(Vector2i(anchor_head_point.pp_position.x,anchor_head_point.pp_position.y - minsize),PointType.BOTTOM_LEFT) #左下2
	bottom_left_point = tail
	head.next_point.next_point.next_point = tail
	
	tail.last_point = head.next_point.next_point
	
	size = 8
	#初始化完毕，绘制异形窗口
	_reload_all_point()
	redraw_mouse_passthrough_polygon()
#region 异形窗口初始化

func _reload_all_point () -> void:
	_path_points.clear()
	if anchor_head_point == null : 
		push_error("mouse_click_space: anchor point is nill")
		return
	var point = anchor_head_point
	while point != null :
		_path_points.append(point.pp_position)
		point = point.next_point


#region 对外接口

func insert_point (newPoint:PolygonPoint,polygonPoint_owner:Node,pointRangeHead:PointType,pointRangeTail:PointType)-> void:
	var point_direction = _judge_point_direction(pointRangeHead,pointRangeTail)
	var _newpoint = _limitation_to_border(newPoint)
	match point_direction:
		0:#上方
			var insertposition = _calculate_insert_position(_newpoint,point_direction)
			_insert_point(newPoint,insertposition)
	_reload_all_point()

func insert_list (new_head:PolygonPoint,new_tile:PolygonPoint,polygonPoint_owner,pointRangeHead:PointType,pointRangeTail:PointType)->void:
	var _head = new_head
	while _head != null:
		_limitation_to_border(_head)
		_head = _head.next_point
	_PolygonPointMap.get_or_add(polygonPoint_owner,[new_head,new_tile])
	var point_direction = _judge_point_direction(pointRangeHead,pointRangeTail)
	match point_direction:
		0:#上方
			var insertposition = _calculate_insert_position(new_head,point_direction)
			_insert_list(new_head,new_tile,insertposition)
	_reload_all_point()

func delete_list (polygonPoint_owner:Node,clean_click_space:bool = true) ->void:
	if clean_click_space:
		get_window().mouse_passthrough_polygon = []
	var list = _PolygonPointMap.get(polygonPoint_owner) as Array
	if list == null : 
		#push_error("can not find owner. ownerID : %s",polygonPoint_owner)
		return
	var _head = list.get(0) as PolygonPoint
	var _tile = list.get(1) as PolygonPoint
	_head.last_point.next_point = _tile.next_point
	_tile.next_point.last_point = _head.last_point
	_reload_all_point()

#endregion
func _calculate_insert_position(newPoint:PolygonPoint,point_direction:int)-> PolygonPoint:
	var current_point:PolygonPoint
	match point_direction:
		0:#顶部的点
			current_point = top_left_point
			while current_point != null:
				if newPoint.pp_position.x > current_point.pp_position.x: #查找新的点应该在的位置
					current_point = current_point.next_point
					return current_point
				else:
					return current_point
		1:#左侧的点
			pass
	return null

func _insert_point (new_insert_position:PolygonPoint,after_point:PolygonPoint) ->void:
	new_insert_position.next_point = after_point
	new_insert_position.last_point = after_point.last_point
	after_point.last_point.next_point = new_insert_position
	after_point.last_point = new_insert_position

func _insert_list (new_head:PolygonPoint,new_tile:PolygonPoint,after_point:PolygonPoint) ->void:
	new_tile.next_point = after_point
	new_head.last_point = after_point.last_point
	after_point.last_point.next_point = new_head
	after_point.last_point = new_tile

func _judge_point_direction (pointRangeHead:PointType,pointRangeTail:PointType) -> int:
	if pointRangeHead - pointRangeTail == 0 or abs(pointRangeHead - pointRangeTail) >1 :
		push_error("mouse_click_space:")
		return -1
	if pointRangeHead + pointRangeTail == 1:
		return 0
	if pointRangeHead + pointRangeTail == 3:
		return 1
	if pointRangeHead + pointRangeTail == 5:
		return 2
	return -1


func _limitation_to_border(newPoint:PolygonPoint) -> PolygonPoint:
	var _newPoint = newPoint
	if _newPoint.pp_position.x < _minsize :
		_newPoint.pp_position.x = _minsize
	if _newPoint.pp_position.x > _screen_size.x - _minsize:
		_newPoint.pp_position.x = _screen_size.x - _minsize
	if _newPoint.pp_position.y < _minsize :
		_newPoint.pp_position.y = _minsize
	if _newPoint.pp_position.y > _screen_size.y - _minsize:
		_newPoint.pp_position.y = _screen_size.y - _minsize
		
	return _newPoint

#将外部添加的点依次加到数组中
#func _update_path_points () ->void: #！！！！！！！！！！！！！！！！！！！！！！！！！状态好的时候看看这里能不能做性能优化
	#_path_points.clear()
	#_path_points.append_array(_base_path_points)
	#_path_points.append_array(_bottom_path_points)
	#for i in range(1,_right_path_points.size()):
		#_path_points.append(_right_path_points[i])
	#for i in range(1,_top_path_points.size()):
		#_path_points.append(_top_path_points[i])

func redraw_mouse_passthrough_polygon() ->void:
	get_window().mouse_passthrough_polygon = _path_points

func clean_mouse_passthrough_polygon() -> void:
	get_window().mouse_passthrough_polygon = []

#region point数组排序

func _points_bubble_sort(arr:PackedVector2Array,direction:PointType,ascending: bool = true) -> PackedVector2Array:
	var _temp_arr = arr as Array
	match direction:
		PointType.TOP_RIGHT:
			_temp_arr.sort_custom(_sort_by_x_descending)
	return _temp_arr
	
func _sort_by_x_ascending (arr_1,arr_2):
	if arr_1[0] < arr_2[0]:
		return true
	return false

func _sort_by_x_descending(arr_1,arr_2):
	if arr_1[0] >arr_2[0]:
		return true
	return false

func _sort_by_y_ascending(arr_1,arr_2):
	if arr_1[1] < arr_2[1]:
		return true
	return false

func _sort_by_y_descending(arr_1,arr_2):
	if arr_1[1] >arr_2[1]:
		return true
	return false
#endregion

#region 有问题 不能用
#插入点位
#func add_node(new_pos:Vector2i,node_type:PointType,after:PolygonPoint) -> void:
	## 插入新节点到指定位置后
	#pass
	#
##当前值支持添加两个点，多了会出BUG
#func add_mouse_click_space(point_owner:Node2D,firstpoint:Vector2,secondpoint:Vector2,direction:PointType)->void:
	#var _temp_arr : Array
	#match direction:
		#PointType.TOP_RIGHT:
			##根据添加的点，在边框处添加一个对应的点
			#if firstpoint.x > secondpoint.x :
				#_temp_arr = [Vector2(firstpoint.x + 0.1,_minsize),Vector2(secondpoint.x - 0.1,_minsize),firstpoint,secondpoint]
			#else:
				#_temp_arr = [Vector2(firstpoint.x - 0.1,_minsize),Vector2(secondpoint.x + 0.1,_minsize),firstpoint,secondpoint]
			#_top_path_points.append_array(_temp_arr)
			#_top_path_points = _points_bubble_sort(_top_path_points,direction,true)
			#pass
		#PointType.TOP_RIGHT:
			#pass
		#PointType.TOP_RIGHT:
			#pass
	#_dynamin_path_points[point_owner] = _temp_arr#存储对应对象的点位
	#_points_owner_direction[point_owner] = direction #记录point_owner 的direction
	#_update_path_points()
#
#func remove_mouse_click_space(point_owner:Node2D)->void:
	#var _remove_points = _dynamin_path_points.get(point_owner) as PackedVector2Array
	#if _remove_points == null : return
	#var direciton = _points_owner_direction.get(point_owner) as PointType
	#match direciton:
		#PointType.TOP_RIGHT:
			#for point in _remove_points:
				#_top_path_points.remove_at(_top_path_points.rfind(point))
#
#func _bubble_sort_by_vector2X(arr:PackedVector2Array,ascending: bool = true) -> PackedVector2Array:
	#var n = arr.size()
	#var _temp_arr = arr as Array
	#for i in range(n):
		#var swapped = false # 优化标志位
		##内层循环范围随已排序元素增加而缩小
		#for j in range(0,n - i -1):
			##根据排序方向选择比较条件
			#if ascending :
				#if _temp_arr[j].x > _temp_arr[j+1].x:
					##_temp_arr.swap(j,j+1) #元素交换
					#swapped = true
			#else :
				#if _temp_arr[j].x < _temp_arr[j+1].x:
					##_temp_arr.swap(j,j+1)
					#swapped = true
		## 无交换时提前终止排序
		#if not swapped: break
	#return _temp_arr
#
#func _bubble_sort_by_vector2Y(arr:PackedVector2Array,ascending: bool = true) -> PackedVector2Array:
	#var n = arr.size()
	#var _temp_arr = arr as Array
	#for i in range(n):
		#var swapped = false # 优化标志位
		##内层循环范围随已排序元素增加而缩小
		#for j in range(0,n - i -1):
			##根据排序方向选择比较条件
			#if ascending :
				#if _temp_arr[j].y > _temp_arr[j+1].y:
					##_temp_arr.swap(j,j+1) #元素交换
					#swapped = true
			#else :
				#if _temp_arr[j].y < _temp_arr[j+1].y:
					##_temp_arr.swap(j,j+1)
					#swapped = true
		## 无交换时提前终止排序
		#if not swapped: break
	#return _temp_arr
#
##鸡尾酒排序     TODO：目前只是按照Vector的X值排序，需要优化自行选择按照X或者Y排序
#func cocktail_sort(arr:PackedVector2Array,ascending:bool = true) -> PackedVector2Array:
	#var left = 0
	#var right = arr.size() - 1
	#var _temp_array = arr as Array
	#while left < right:
		#var swapped =false
		## 左➡️右冒泡
		#for j in range(left,right):
			#if ascending :
				#if (_temp_array[j].x > _temp_array[j+1].x) :
					#_temp_array.swap(j,j+1)
					#swapped = true
			#else :
				#if (_temp_array[j-1].x < _temp_array[j].x) :
					#_temp_array.swap(j,j+1)
					#swapped = true
		#right -= 1
		##右➡️左冒泡
		#for j in range(right,left,-1):
			#if ascending :
				#if (_temp_array[j -1].x > _temp_array[j].x) :
					#_temp_array.swap(j-1,j)
					#swapped = true
			#else :
				#if (_temp_array[j-1].x < _temp_array[j].x) :
					#_temp_array.swap(j-1,j)
					#swapped = true
		#left += 1
		#if not swapped: break
	#return _temp_array
#endregion
